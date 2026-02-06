#!/usr/bin/env python3
"""
DOTT Upload v6 - Testing size header values

Theory: Size header triggers receive mode, but what value should it contain?
- Just GIF size? (2365)
- Total including header? (2369)
- Something else?
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
        
    async def upload_with_size(self, gif_data, size_value, description):
        """Upload with a specific size value in header."""
        print(f"\n{'='*60}")
        print(f"Testing: {description}")
        print(f"Size in header: {size_value}, GIF data: {len(gif_data)} bytes")
        print(f"{'='*60}")
        
        self.notifications.clear()
        chunk_size = self.mtu - 3
        
        # Step 1: Size header (triggers device)
        size_header = struct.pack('<I', size_value)
        print(f"Trigger: {size_header.hex()} ({size_value})")
        await self.client.write_gatt_char(UUID_CONTROL, size_header, response=False)
        await asyncio.sleep(0.15)
        
        if any('fail' in n.lower() for n in self.notifications):
            print("[X] Failed at trigger!")
            return False
            
        # Step 2: Send GIF data
        print(f"Streaming {len(gif_data)} bytes...")
        for i in range(0, len(gif_data), chunk_size):
            chunk = gif_data[i:i+chunk_size]
            await self.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
            await asyncio.sleep(0.005)
            
        print("Transfer done, waiting...")
        await asyncio.sleep(1.5)
        
        print(f"Result: {self.notifications}")
        
        if any('complete' in n.lower() for n in self.notifications):
            print("\n*** SUCCESS! ***")
            return True
        elif any('fail' in n.lower() for n in self.notifications):
            return False
        else:
            print("[?] No notification")
            return None
            
    async def run_tests(self, gif_data):
        tests = [
            # (size_value, description)
            (len(gif_data), "Size = GIF length"),
            (len(gif_data) + 4, "Size = GIF + 4 (header)"),
            (len(gif_data) - 4, "Size = GIF - 4"),
            (0, "Size = 0"),
            (0xFFFFFFFF, "Size = max uint32"),
        ]
        
        for size_val, desc in tests:
            result = await self.upload_with_size(gif_data, size_val, desc)
            if result:
                return
            await asyncio.sleep(2.5)  # Reset between tests


async def main():
    if len(sys.argv) < 2:
        print("Usage: python dott_upload_v6.py <gif_file>")
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
