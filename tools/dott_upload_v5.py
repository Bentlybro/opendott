#!/usr/bin/env python3
"""
DOTT Upload v5 - Testing different size/data formats

Trying multiple approaches to find what the device expects.
"""

import asyncio
import struct
import sys
import time

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print("pip install bleak")
    sys.exit(1)

UUID_CONTROL = "00001525-0000-1000-8000-00805f9b34fb"
UUID_DATA = "00001529-0000-1000-8000-00805f9b34fb"
UUID_RESPONSE = "00001530-0000-1000-8000-00805f9b34fb"
UUID_ACK = "00001528-0000-1000-8000-00805f9b34fb"


class DOTTUploader:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.notifications = []
        
    def _notify(self, sender, data):
        text = data.decode('utf-8', errors='ignore')
        print(f"  [NOTIFY] '{text}'")
        self.notifications.append(text)
        
    async def connect(self):
        self.client = BleakClient(self.address)
        await self.client.connect()
        self.mtu = self.client.mtu_size or 23
        print(f"Connected, MTU: {self.mtu}")
        
        for uuid in [UUID_DATA, UUID_RESPONSE, UUID_ACK]:
            try:
                await self.client.start_notify(uuid, self._notify)
            except:
                pass
        await asyncio.sleep(0.2)
        
    async def disconnect(self):
        await self.client.disconnect()
        print("Disconnected")
        
    async def test_upload(self, name, gif_data, write_func):
        """Test an upload method."""
        print(f"\n{'='*60}")
        print(f"Testing: {name}")
        print(f"{'='*60}")
        
        self.notifications.clear()
        
        try:
            await write_func(gif_data)
        except Exception as e:
            print(f"Error: {e}")
            
        await asyncio.sleep(1.5)
        
        print(f"Notifications: {self.notifications}")
        
        if any('complete' in n.lower() for n in self.notifications):
            print("[OK] SUCCESS!")
            return True
        elif any('fail' in n.lower() for n in self.notifications):
            print("[X] FAILED")
            return False
        else:
            print("[?] No response")
            return None
            
    async def run_tests(self, gif_data):
        chunk_size = self.mtu - 3
        
        # Method A: Size in first chunk (little-endian), rest follows
        async def method_a(data):
            print("Method A: [LE size + data start] then [rest of data] -> 0x1525")
            full = struct.pack('<I', len(data)) + data
            for i in range(0, len(full), chunk_size):
                chunk = full[i:i+chunk_size]
                await self.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
                await asyncio.sleep(0.005)
                
        # Method B: Size in first chunk (big-endian)
        async def method_b(data):
            print("Method B: [BE size + data start] then [rest of data] -> 0x1525")
            full = struct.pack('>I', len(data)) + data
            for i in range(0, len(full), chunk_size):
                chunk = full[i:i+chunk_size]
                await self.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
                await asyncio.sleep(0.005)
                
        # Method C: Just raw GIF data, no size at all
        async def method_c(data):
            print("Method C: Raw GIF data only -> 0x1525")
            for i in range(0, len(data), chunk_size):
                chunk = data[i:i+chunk_size]
                await self.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
                await asyncio.sleep(0.005)
                
        # Method D: 2-byte size (little-endian)
        async def method_d(data):
            print("Method D: [2-byte LE size + data] -> 0x1525")
            full = struct.pack('<H', len(data)) + data
            for i in range(0, len(full), chunk_size):
                chunk = full[i:i+chunk_size]
                await self.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
                await asyncio.sleep(0.005)
                
        # Method E: Size as separate write, then raw GIF to DATA char
        async def method_e(data):
            print("Method E: Size -> 0x1525, Raw GIF -> 0x1529")
            await self.client.write_gatt_char(UUID_CONTROL, struct.pack('<I', len(data)), response=False)
            await asyncio.sleep(0.1)
            for i in range(0, len(data), chunk_size):
                chunk = data[i:i+chunk_size]
                try:
                    await self.client.write_gatt_char(UUID_DATA, chunk, response=True)
                except:
                    await self.client.write_gatt_char(UUID_DATA, chunk, response=False)
                await asyncio.sleep(0.005)
                
        # Method F: Total size (including header) in header
        async def method_f(data):
            print("Method F: [LE size of size+data] + data -> 0x1525")
            total_size = 4 + len(data)  # Size includes the 4-byte header itself
            full = struct.pack('<I', total_size) + data
            for i in range(0, len(full), chunk_size):
                chunk = full[i:i+chunk_size]
                await self.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
                await asyncio.sleep(0.005)

        # Method G: Slower transfer (20ms delay)
        async def method_g(data):
            print("Method G: [LE size + data] -> 0x1525 (20ms delay)")
            full = struct.pack('<I', len(data)) + data
            for i in range(0, len(full), chunk_size):
                chunk = full[i:i+chunk_size]
                await self.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
                await asyncio.sleep(0.020)  # 20ms delay
                
        # Method H: Write with response (slower but more reliable?)
        async def method_h(data):
            print("Method H: [LE size + data] -> 0x1525 (write with response)")
            full = struct.pack('<I', len(data)) + data
            for i in range(0, len(full), chunk_size):
                chunk = full[i:i+chunk_size]
                # 0x1525 only supports write-without-response, so this will fail
                # But let's try anyway to see error
                try:
                    await self.client.write_gatt_char(UUID_CONTROL, chunk, response=True)
                except Exception as e:
                    print(f"  (using no-response: {e})")
                    await self.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
                await asyncio.sleep(0.005)

        # Run tests
        methods = [
            ("A: LE size embedded", method_a),
            ("B: BE size embedded", method_b),
            ("C: Raw GIF only", method_c),
            # ("D: 2-byte size", method_d),
            # ("E: Split size/data", method_e),
            # ("F: Total size in header", method_f),
            # ("G: Slower (20ms)", method_g),
        ]
        
        for name, func in methods:
            result = await self.test_upload(name, gif_data, func)
            if result:
                print(f"\n*** {name} WORKED! ***")
                return
            # Wait between tests for device to reset
            await asyncio.sleep(2)


async def main():
    if len(sys.argv) < 2:
        print("Usage: python dott_upload_v5.py <gif_file>")
        return
        
    with open(sys.argv[1], 'rb') as f:
        gif_data = f.read()
    print(f"Loaded: {sys.argv[1]} ({len(gif_data)} bytes)")
    
    print("Scanning...")
    devices = await BleakScanner.discover(timeout=5.0)
    dott = [d for d in devices if d.name and "dott" in d.name.lower()]
    if not dott:
        print("No DOTT found!")
        return
        
    uploader = DOTTUploader(dott[0].address)
    await uploader.connect()
    await uploader.run_tests(gif_data)
    await uploader.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
