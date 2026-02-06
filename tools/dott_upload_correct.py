#!/usr/bin/env python3
"""
DOTT Upload - Correct protocol based on btsnoop analysis

Protocol (from btsnoop capture):
1. Write FILE SIZE (4-byte LE) to 0x1528 (trigger/ACK characteristic)
2. Wait for indication (should get 0xFFFFFFFF)
3. Stream raw GIF data to 0x1525 (data characteristic)
4. Wait for "Transfer Complete" notification

Key insight: The 0x00401000 value in capture = 1,064,960 bytes = the GIF file size!
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

# UUIDs from device
UUID_SERVICE = "0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc"
UUID_DATA = "00001525-0000-1000-8000-00805f9b34fb"     # Handle 0x0017 - GIF data
UUID_TRIGGER = "00001528-0000-1000-8000-00805f9b34fb"  # Handle 0x001d - Trigger/size

CHUNK_DELAY_MS = 5


class DOTTUploader:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.notifications = []
        self.indication_received = asyncio.Event()
        
    def _notification_handler(self, sender, data):
        """Handle notifications and indications."""
        text = data.decode('utf-8', errors='ignore').strip('\x00')
        hex_str = data.hex()
        print(f"  [NOTIFY] sender={sender} hex={hex_str} text='{text}'")
        self.notifications.append((sender, data, text))
        
        # Check for indication acknowledgment (0xFFFFFFFF or similar)
        if data == b'\xff\xff\xff\xff' or hex_str == 'ffffffff':
            print("  -> Indication received! Ready for data.")
            self.indication_received.set()
            
    async def connect(self):
        print(f"Connecting to {self.address}...")
        self.client = BleakClient(self.address)
        await self.client.connect()
        
        mtu = self.client.mtu_size or 23
        print(f"Connected! MTU: {mtu}")
        
        # Enable notifications/indications on trigger characteristic
        print("Enabling indications on 0x1528...")
        try:
            await self.client.start_notify(UUID_TRIGGER, self._notification_handler)
            print("  OK - Indications enabled")
        except Exception as e:
            print(f"  Warning: {e}")
            
        await asyncio.sleep(0.2)
        return mtu
        
    async def disconnect(self):
        if self.client:
            await self.client.disconnect()
        print("Disconnected")
        
    async def upload(self, gif_data):
        """
        Upload GIF using correct protocol:
        1. Send file size to trigger characteristic
        2. Wait for indication
        3. Stream data
        """
        print(f"\n{'='*60}")
        print("DOTT Upload - Correct Protocol")
        print(f"{'='*60}")
        print(f"GIF size: {len(gif_data)} bytes ({len(gif_data)/1024:.1f}KB)")
        
        self.notifications.clear()
        self.indication_received.clear()
        
        mtu = self.client.mtu_size or 23
        chunk_size = mtu - 3
        if chunk_size < 20:
            chunk_size = 20
            
        print(f"Chunk size: {chunk_size} bytes")
        
        # STEP 1: Send file size as trigger
        size_bytes = struct.pack('<I', len(gif_data))
        print(f"\nStep 1: Sending file size to 0x1528...")
        print(f"  Value: {size_bytes.hex()} = {len(gif_data)} bytes")
        
        try:
            # Write with response (trigger characteristic supports it)
            await self.client.write_gatt_char(UUID_TRIGGER, size_bytes, response=True)
            print("  OK - Size sent (write with response)")
        except Exception as e:
            print(f"  Write with response failed: {e}")
            # Try without response
            try:
                await self.client.write_gatt_char(UUID_TRIGGER, size_bytes, response=False)
                print("  OK - Size sent (write without response)")
            except Exception as e2:
                print(f"  FAILED: {e2}")
                return False
        
        # STEP 2: Wait for indication
        print("\nStep 2: Waiting for indication (max 5s)...")
        try:
            await asyncio.wait_for(self.indication_received.wait(), timeout=5.0)
            print("  -> Indication received!")
        except asyncio.TimeoutError:
            print("  -> No indication received (timeout)")
            # Continue anyway - device might not require it
            
        await asyncio.sleep(0.1)
        
        # STEP 3: Stream GIF data
        print(f"\nStep 3: Streaming GIF data to 0x1525...")
        
        total_chunks = (len(gif_data) + chunk_size - 1) // chunk_size
        start_time = time.time()
        
        for i in range(0, len(gif_data), chunk_size):
            chunk = gif_data[i:i+chunk_size]
            chunk_num = i // chunk_size + 1
            
            try:
                await self.client.write_gatt_char(UUID_DATA, chunk, response=False)
            except Exception as e:
                print(f"\n  FAILED at chunk {chunk_num}: {e}")
                return False
                
            # Progress
            if chunk_num % 50 == 0 or chunk_num == total_chunks:
                pct = int((i + len(chunk)) / len(gif_data) * 100)
                elapsed = time.time() - start_time
                rate = ((i + len(chunk)) * 8 / 1024) / elapsed if elapsed > 0 else 0
                print(f"  [{pct:3d}%] {chunk_num}/{total_chunks} chunks | {rate:.1f} kbps")
                
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
            
        elapsed = time.time() - start_time
        rate = (len(gif_data) * 8 / 1024) / elapsed if elapsed > 0 else 0
        print(f"\nData transfer complete: {len(gif_data)} bytes in {elapsed:.2f}s ({rate:.1f} kbps)")
        
        # STEP 4: Wait for completion notification
        print("\nStep 4: Waiting for device response (3s)...")
        await asyncio.sleep(3.0)
        
        print(f"\nNotifications received: {len(self.notifications)}")
        for sender, data, text in self.notifications:
            print(f"  {data.hex()} = '{text}'")
            
        # Check result
        success = any('complete' in t.lower() for _, _, t in self.notifications)
        fail = any('fail' in t.lower() for _, _, t in self.notifications)
        
        if success:
            print("\n[OK] UPLOAD SUCCESSFUL!")
            return True
        elif fail:
            print("\n[X] UPLOAD FAILED")
            return False
        else:
            print("\n[?] No clear result - check device display")
            return None


async def main():
    if len(sys.argv) < 2:
        print("Usage: python dott_upload_correct.py <gif_file> [device_address]")
        print("\nThis uses the CORRECT protocol:")
        print("  1. Send file size to 0x1528 (trigger)")
        print("  2. Wait for indication")
        print("  3. Stream data to 0x1525")
        return
        
    # Load GIF
    with open(sys.argv[1], 'rb') as f:
        gif_data = f.read()
    print(f"Loaded: {sys.argv[1]} ({len(gif_data)} bytes)")
    
    # Validate GIF
    if gif_data[:6] not in (b'GIF87a', b'GIF89a'):
        print("WARNING: Not a valid GIF file!")
    if gif_data[-1:] != b'\x3b':
        print("WARNING: GIF doesn't end with 0x3B trailer!")
        
    # Get device address
    address = sys.argv[2] if len(sys.argv) > 2 else None
    
    if not address:
        print("\nScanning for DOTT devices...")
        devices = await BleakScanner.discover(timeout=5.0)
        dott_devices = [d for d in devices if d.name and "dott" in d.name.lower()]
        
        if not dott_devices:
            print("No DOTT devices found!")
            return
            
        address = dott_devices[0].address
        print(f"Found: {dott_devices[0].name} ({address})")
        
    # Upload
    uploader = DOTTUploader(address)
    try:
        await uploader.connect()
        await uploader.upload(gif_data)
    finally:
        await uploader.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
