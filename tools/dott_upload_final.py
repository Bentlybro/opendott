#!/usr/bin/env python3
"""
DOTT Upload - Final version based on captured traffic analysis

The trigger value 0x00401000 from the capture = 1,064,960 bytes (LE)
That was probably the size of the GIF being uploaded!

So the protocol is:
1. Write GIF_SIZE (4 bytes LE) to 0x1528 (trigger)
2. Write raw GIF bytes to 0x1525 (data)
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

UUID_1525 = "00001525-0000-1000-8000-00805f9b34fb"  # Data
UUID_1528 = "00001528-0000-1000-8000-00805f9b34fb"  # Trigger
UUID_1529 = "00001529-0000-1000-8000-00805f9b34fb"  # Alt data
UUID_1530 = "00001530-0000-1000-8000-00805f9b34fb"  # Response


class DOTTUploader:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.notifications = []
        
    def _notify(self, sender, data):
        text = data.decode('utf-8', errors='ignore')
        print(f"  [NOTIFY] {data.hex()} = '{text}'")
        self.notifications.append(text)
        
    async def connect(self):
        self.client = BleakClient(self.address)
        await self.client.connect()
        self.mtu = self.client.mtu_size or 23
        print(f"Connected, MTU: {self.mtu}")
        
        # Enable notifications
        for uuid in [UUID_1528, UUID_1529, UUID_1530]:
            try:
                await self.client.start_notify(uuid, self._notify)
            except:
                pass
        await asyncio.sleep(0.2)
        
    async def disconnect(self):
        await self.client.disconnect()
        print("Disconnected")
        
    async def upload(self, gif_data):
        """Upload GIF with size-based trigger."""
        print(f"\n{'='*60}")
        print(f"Uploading {len(gif_data)} bytes")
        print(f"{'='*60}\n")
        
        self.notifications.clear()
        chunk_size = self.mtu - 3
        
        # TRIGGER: Write to 0x1528
        # From capture: 0x00401000 was used - maybe it's a command, not size?
        # Let's try the exact value from the capture first
        trigger_from_capture = bytes([0x00, 0x40, 0x10, 0x00])
        size_trigger = struct.pack('<I', len(gif_data))
        
        # Try the exact captured trigger value
        trigger = trigger_from_capture
        print(f"Step 1: Trigger with captured value ({trigger.hex()})")
        try:
            await self.client.write_gatt_char(UUID_1528, size_trigger, response=True)
            print("  OK")
        except Exception as e:
            print(f"  Error: {e}")
            return False
            
        # Wait longer for indication
        print("  Waiting for indication...")
        for _ in range(10):  # Wait up to 1 second
            await asyncio.sleep(0.1)
            if self.notifications:
                print(f"  Got indication: {self.notifications}")
                break
        else:
            print("  No indication received (continuing anyway)")
            
        # DATA: Write raw GIF to 0x1525
        print(f"\nStep 2: Sending GIF data...")
        start = time.time()
        
        for i in range(0, len(gif_data), chunk_size):
            chunk = gif_data[i:i+chunk_size]
            await self.client.write_gatt_char(UUID_1525, chunk, response=False)
            await asyncio.sleep(0.005)
            
            if (i // chunk_size + 1) % 20 == 0:
                pct = int(((i + len(chunk)) / len(gif_data)) * 100)
                print(f"  [{pct:3d}%]")
                
        elapsed = time.time() - start
        print(f"\nTransfer: {len(gif_data)} bytes in {elapsed:.2f}s")
        
        # Wait for response
        print("\nWaiting for response...")
        await asyncio.sleep(2.0)
        
        print(f"Notifications: {self.notifications}")
        
        if any('complete' in n.lower() for n in self.notifications):
            print("\n*** SUCCESS! ***")
            return True
        elif any('fail' in n.lower() for n in self.notifications):
            print("\n[X] FAILED")
            return False
        
        # If no notification, maybe success? Check if screen updated
        print("\n[?] No notification - check if screen updated!")
        return None


async def main():
    if len(sys.argv) < 2:
        print("Usage: python dott_upload_final.py <gif_file>")
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
    await uploader.upload(gif_data)
    await uploader.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
