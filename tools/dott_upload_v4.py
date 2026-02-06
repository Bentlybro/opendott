#!/usr/bin/env python3
"""
DOTT Upload v4 - Size + Data both to Control (0x1525)

Theory: The trigger (size header) goes to 0x1525 and triggers receive mode.
Then the GIF data should ALSO go to 0x1525, not a different characteristic.
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

UUID_SERVICE = "0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc"
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
        print(f"  [NOTIFY] {data.hex()} = '{text}'")
        self.notifications.append(text)
        
    async def connect(self):
        self.client = BleakClient(self.address)
        await self.client.connect()
        self.mtu = self.client.mtu_size or 23
        print(f"Connected, MTU: {self.mtu}")
        
        # Enable notifications
        for uuid in [UUID_DATA, UUID_RESPONSE, UUID_ACK]:
            try:
                await self.client.start_notify(uuid, self._notify)
            except:
                pass
        await asyncio.sleep(0.2)
        
    async def disconnect(self):
        await self.client.disconnect()
        print("Disconnected")
        
    async def upload(self, gif_data, delay_ms=5, pause_after_trigger_ms=100):
        """Upload GIF: size header then data, both to 0x1525."""
        
        print(f"\n{'='*60}")
        print(f"Upload: {len(gif_data)} bytes")
        print(f"Chunk delay: {delay_ms}ms, Post-trigger pause: {pause_after_trigger_ms}ms")
        print(f"{'='*60}\n")
        
        self.notifications.clear()
        chunk_size = self.mtu - 3
        
        # Step 1: Send size header
        size_header = struct.pack('<I', len(gif_data))
        print(f"Step 1: Size header -> 0x1525 ({size_header.hex()})")
        await self.client.write_gatt_char(UUID_CONTROL, size_header, response=False)
        
        # Pause to let device enter receive mode
        print(f"  Pausing {pause_after_trigger_ms}ms for device...")
        await asyncio.sleep(pause_after_trigger_ms / 1000.0)
        
        # Check for early failure
        if any('fail' in n.lower() for n in self.notifications):
            print(f"[X] Device rejected trigger!")
            return False
            
        # Step 2: Stream GIF data to SAME characteristic
        print(f"Step 2: Streaming {len(gif_data)} bytes -> 0x1525")
        
        start = time.time()
        total_chunks = (len(gif_data) + chunk_size - 1) // chunk_size
        
        for i, offset in enumerate(range(0, len(gif_data), chunk_size)):
            chunk = gif_data[offset:offset + chunk_size]
            await self.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
            
            if (i + 1) % 20 == 0 or i + 1 == total_chunks:
                pct = int(((offset + len(chunk)) / len(gif_data)) * 100)
                print(f"  [{pct:3d}%] chunk {i+1}/{total_chunks}")
                
            await asyncio.sleep(delay_ms / 1000.0)
            
        elapsed = time.time() - start
        print(f"\nTransfer complete: {elapsed:.2f}s")
        
        # Wait for response
        print("Waiting for device response...")
        await asyncio.sleep(1.5)
        
        # Check result
        print(f"\nNotifications: {self.notifications}")
        
        if any('complete' in n.lower() for n in self.notifications):
            print("\n[OK] SUCCESS!")
            return True
        elif any('fail' in n.lower() for n in self.notifications):
            print("\n[X] FAILED")
            return False
        else:
            print("\n[?] No clear response")
            return None


async def main():
    if len(sys.argv) < 2:
        print("Usage: python dott_upload_v4.py <gif_file> [delay_ms] [pause_ms]")
        return
        
    with open(sys.argv[1], 'rb') as f:
        gif_data = f.read()
    print(f"Loaded: {sys.argv[1]} ({len(gif_data)} bytes)")
    
    delay_ms = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    pause_ms = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    
    # Find device
    print("Scanning...")
    devices = await BleakScanner.discover(timeout=5.0)
    dott = [d for d in devices if d.name and "dott" in d.name.lower()]
    if not dott:
        print("No DOTT found!")
        return
        
    uploader = DOTTUploader(dott[0].address)
    await uploader.connect()
    
    await uploader.upload(gif_data, delay_ms=delay_ms, pause_after_trigger_ms=pause_ms)
    
    await uploader.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
