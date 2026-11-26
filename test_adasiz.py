"""Offline regression tests using synthetic service responses."""
import unittest
from unittest.mock import AsyncMock, patch
from pydantic import ValidationError
import server
BASE=dict(province="Test ili",district="Test ilçesi",place="Test mahallesi",parcel="2260")
GEOMETRY={"type":"Polygon","coordinates":[[[29.0,40.0],[29.001,40.0],[29.001,40.001],[29.0,40.0]]]}
class AdasizParselTests(unittest.IsolatedAsyncioTestCase):
    def test_optional_block(self):
        self.assertEqual(server.Req(**BASE).block,"0")
        for value in ("",None,"0",0,"000"," 0 "):
            self.assertEqual(server.Req(**BASE,block=value).block,"0")
        self.assertEqual(server.Req(**BASE,block="354").block,"354")
        for value in ("-1","-","abc","1.5","1234567890"):
            with self.assertRaises(ValidationError):
                server.Req(**BASE,block=value)
    async def test_adasiz(self):
        for value in (None,""," ",0,"0","-"):
            data={"type":"Feature","properties":{"adaNo":value,"parselNo":2260,"alan":"337.19","nitelik":"Arsa"},"geometry":GEOMETRY}
            with patch.object(server,"getjson",new=AsyncMock(return_value=data)) as mock:
                result=await server.parcel_data(None,"123456","","2260")
                mock.assert_awaited_once_with(None,server.TKGM+"/parsel/123456/0/2260",900)
                self.assertEqual(result["block"],"0")
                self.assertEqual(result["area"],337.19)
    async def test_numbered_and_mismatch(self):
        for actual,requested,parcel,valid in ((354,"354",2260,True),(354,"0",2260,False),(None,"354",2260,False),(None,"0",2261,False)):
            data={"type":"Feature","properties":{"adaNo":actual,"parselNo":parcel,"alan":"337.19"},"geometry":GEOMETRY}
            with patch.object(server,"getjson",new=AsyncMock(return_value=data)):
                if valid:
                    self.assertEqual((await server.parcel_data(None,"123456",requested,"2260"))["block"],"354")
                else:
                    with self.assertRaises(ValueError):
                        await server.parcel_data(None,"123456",requested,"2260")
if __name__=="__main__":
    unittest.main()
