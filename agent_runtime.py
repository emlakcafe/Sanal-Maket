"""Bounded, request-triggered research jobs with observable execution state.

These agents execute rules and tools. They are not labelled as language models;
Google AI configuration and execution are reported separately by the caller.
"""
from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import secrets
import time


AGENTS = (
    ("parcel", "Parsel doğrulama"),
    ("search", "İnternetten ilan keşfi"),
    ("remax", "RE/MAX ilan araştırması"),
    ("emlakjet", "Emlakjet ilan araştırması"),
    ("location", "Konum ve emsal doğrulama"),
    ("valuation", "Fiyat değerlendirmesi"),
)
AGENT_STATUSES = {"waiting", "running", "complete", "partial", "blocked", "error"}
TERMINAL_JOBS = {"complete", "partial", "error"}


def _now():
    return datetime.now(timezone.utc).isoformat()


class RuntimeBusy(Exception):
    pass


class AgentRuntime:
    def __init__(self, max_running=2, max_jobs=32, retention_seconds=900, timeout_seconds=140):
        self.max_running = max_running
        self.max_jobs = max_jobs
        self.retention_seconds = retention_seconds
        self.timeout_seconds = timeout_seconds
        self.jobs = {}
        self.tasks = {}

    def _prune(self):
        now = time.monotonic()
        for job_id, job in list(self.jobs.items()):
            if job["status"] in TERMINAL_JOBS and now - job["_created"] >= self.retention_seconds:
                self.jobs.pop(job_id, None)

    @property
    def running_jobs(self):
        return sum(job["status"] not in TERMINAL_JOBS for job in self.jobs.values())

    def start(self, request, runner, ai=None):
        self._prune()
        if self.running_jobs >= self.max_running:
            raise RuntimeBusy("Araştırma sunucusu meşgul. Devam eden sorgular tamamlanınca yeniden deneyin.")
        while len(self.jobs) >= self.max_jobs:
            completed = next((key for key, job in self.jobs.items() if job["status"] in TERMINAL_JOBS), None)
            if completed is None:
                raise RuntimeBusy("Araştırma sunucusu meşgul.")
            self.jobs.pop(completed)
        job_id = secrets.token_urlsafe(24)
        now = _now()
        job = {
            "job_id": job_id, "status": "queued", "created_at": now,
            "updated_at": now, "finished_at": None,
            "agents": [{"id": key, "name": name, "engine": "rules_and_tools",
                        "status": "waiting", "message": "Sırası bekleniyor.",
                        "counts": {}, "started_at": None, "updated_at": now,
                        "finished_at": None} for key, name in AGENTS],
            "result": None, "search_candidates": [], "error": None,
            "ai": deepcopy(ai or {"configured": False, "status": "not_configured", "running": False}),
            "poll_after_ms": 900, "_created": time.monotonic(),
        }
        self.jobs[job_id] = job
        task = asyncio.create_task(self._run(job_id, request, runner))
        self.tasks[job_id] = task
        task.add_done_callback(lambda _: self.tasks.pop(job_id, None))
        return self.snapshot(job_id)

    def snapshot(self, job_id):
        self._prune()
        job = self.jobs.get(job_id)
        if job is None:
            return None
        result = deepcopy({key: value for key, value in job.items() if not key.startswith("_")})
        result["agent_count"] = len(result["agents"])
        result["active_agent_count"] = sum(agent["status"] == "running" for agent in result["agents"])
        result["completed_agent_count"] = sum(agent["status"] == "complete" for agent in result["agents"])
        return result

    def _emit(self, job_id, agent_id, status, message="", counts=None, *, candidates=None):
        job = self.jobs.get(job_id)
        if job is None or job["status"] in TERMINAL_JOBS:
            return
        if status not in AGENT_STATUSES:
            raise ValueError("Unknown agent execution state")
        agent = next((agent for agent in job["agents"] if agent["id"] == agent_id), None)
        if agent is None:
            raise ValueError("Unknown agent")
        now = _now()
        agent.update(status=status, message=str(message)[:600], updated_at=now)
        if status == "running" and not agent["started_at"]:
            agent["started_at"] = now
        if status not in {"waiting", "running"}:
            agent["finished_at"] = now
        if counts is not None:
            agent["counts"] = deepcopy(counts)
        if candidates is not None:
            job["search_candidates"] = deepcopy(candidates[:100])
        job["updated_at"] = now

    async def _run(self, job_id, request, runner):
        job = self.jobs[job_id]
        job["status"] = "running"
        emit = lambda *args, **kwargs: self._emit(job_id, *args, **kwargs)
        try:
            result = await asyncio.wait_for(runner(request, emit), self.timeout_seconds)
            job["result"] = result
            if isinstance(result, dict):
                job["search_candidates"] = deepcopy(result.get("search_candidates", job["search_candidates"]))[:100]
            for agent in job["agents"]:
                if agent["status"] in {"waiting", "running"}:
                    emit(agent["id"], "blocked", "Bu adım için yeterli veri veya çalışan bağlantı bulunamadı.")
            job["status"] = "partial" if any(agent["status"] in {"partial", "blocked", "error"} for agent in job["agents"]) else "complete"
        except asyncio.CancelledError:
            job["error"] = "Araştırma sunucusu yeniden başlatıldığı için sorgu tamamlanamadı."
            self._finish_failed(job_id, emit)
            raise
        except TimeoutError:
            job["error"] = "Araştırma toplam süre sınırında tamamlanamadı. Yeniden sorgulayın."
            self._finish_failed(job_id, emit)
        except Exception:
            # Never return raw provider bodies, credentials or internal errors.
            job["error"] = "Araştırma tamamlanamadı. Kaynak durumlarını kontrol ederek yeniden deneyin."
            self._finish_failed(job_id, emit)
        finally:
            job["finished_at"] = job["updated_at"] = _now()

    def _finish_failed(self, job_id, emit):
        job = self.jobs[job_id]
        for agent in job["agents"]:
            if agent["status"] == "running":
                emit(agent["id"], "error", job["error"])
            elif agent["status"] == "waiting":
                emit(agent["id"], "blocked", "Önceki adım tamamlanamadığı için çalıştırılmadı.")
        job["status"] = "error"

    async def shutdown(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
