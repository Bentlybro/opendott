#!/usr/bin/env python3
"""
DOTT Upload - Based on CAPTURED BLE traffic from official app!

The official app sequence (from btsnoop capture):
1. Write 0x0200 to handle 0x001e
2. Write 0x00401000 to handle 0x001d  
3. Write raw GIF data to handle 0x0017 (no size header!)

Handles in the capture:
- 0x0017 = GIF data (WriteCmd, no response)
- 0x001d = Trigger (WriteReq with response, gets indication)
- 0x001e = Enable (WriteReq with response)
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


class DOTTUploader:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.handle_map = {}
        self.notifications = []
        
    def _notify(self, handle, data):
        text = data.decode('utf-8', errors='ignore')
        print(f"  [NOTIFY] handle={handle} data={data.hex()} = '{text}'")
        self.notifications.append((handle, data, text))
        
    async def connect(self):
        self.client = BleakClient(self.address)
        await self.client.connect()
        print(f"Connected, MTU: {self.client.mtu_size}")
        
        # Build handle map from services
        print("\nDiscovering handles...")
        for service in self.client.services:
            print(f"  Service: {service.uuid}")
            for char in service.characteristics:
                handle = char.handle
                print(f"    Handle 0x{handle:04x}: {char.uuid} {char.properties}")
                self.handle_map[char.uuid.lower()] = handle
                
                # Enable notifications/indications where supported
                if 'notify' in char.properties or 'indicate' in char.properties:
                    try:
                        await self.client.start_notify(char.uuid, 
                            lambda h, d, handle=handle: self._notify(handle, d))
                        print(f"      -> Notifications enabled")
                    except Exception as e:
                        print(f"      -> Notify failed: {e}")
                        
        await asyncio.sleep(0.3)
        
    async def disconnect(self):
        await self.client.disconnect()
        print("Disconnected")
        
    async def upload_captured_sequence(self, gif_data):
        """
        Replicate EXACT sequence from captured traffic.
        """
        print(f"\n{'='*60}")
        print("Uploading using CAPTURED sequence")
        print(f"GIF size: {len(gif_data)} bytes")
        print(f"{'='*60}\n")
        
        self.notifications.clear()
        
        # Get handles - they might be different on Windows vs the capture
        # The capture was from Android, handles might differ
        # Let's find the right handles by UUID
        
        # From our earlier discovery, the DOTT service characteristics:
        # 0x1525, 0x1526, 0x1527, 0x1528, 0x1529, 0x1530
        
        # Map our known UUIDs to handles
        uuid_1525 = "00001525-0000-1000-8000-00805f9b34fb"
        uuid_1526 = "00001526-0000-1000-8000-00805f9b34fb"
        uuid_1527 = "00001527-0000-1000-8000-00805f9b34fb"
        uuid_1528 = "00001528-0000-1000-8000-00805f9b34fb"
        uuid_1529 = "00001529-0000-1000-8000-00805f9b34fb"
        uuid_1530 = "00001530-0000-1000-8000-00805f9b34fb"
        
        print("Handle mapping:")
        for uuid in [uuid_1525, uuid_1526, uuid_1527, uuid_1528, uuid_1529, uuid_1530]:
            if uuid in self.handle_map:
                print(f"  {uuid}: handle 0x{self.handle_map[uuid]:04x}")
        
        # In the capture:
        # - Handle 0x0017 was for GIF data 
        # - Handle 0x001d was for trigger (4 bytes)
        # - Handle 0x001e was for enable (2 bytes)
        #
        # Let's map by characteristic position/properties:
        # - 0x1525 (read, write-no-response) -> might be 0x0017 (GIF data)
        # - 0x1528 (read, write, indicate) -> might be 0x001e (enable) or 0x001d (trigger)
        # - 0x1529 (write, notify) -> could be trigger
        
        # Actually, let's just try using handles by UUID and see what works
        
        # STEP 1: Enable something (capture showed 0x0200 to 0x001e)
        # Try writing to 0x1528 (has indicate)
        print("\nStep 1: Enable (writing 0x0200)...")
        try:
            await self.client.write_gatt_char(uuid_1528, bytes([0x02, 0x00]), response=True)
            print("  OK - wrote to 0x1528")
        except Exception as e:
            print(f"  Failed on 0x1528: {e}")
            # Try 0x1527
            try:
                await self.client.write_gatt_char(uuid_1527, bytes([0x02, 0x00]), response=True)
                print("  OK - wrote to 0x1527")
            except Exception as e2:
                print(f"  Also failed on 0x1527: {e2}")
                
        await asyncio.sleep(0.1)
        
        # STEP 2: Trigger (capture showed 0x00401000 to 0x001d)
        print("\nStep 2: Trigger (writing 0x00401000)...")
        trigger_data = bytes([0x00, 0x40, 0x10, 0x00])
        try:
            await self.client.write_gatt_char(uuid_1528, trigger_data, response=True)
            print("  OK - wrote to 0x1528")
        except Exception as e:
            print(f"  Failed on 0x1528: {e}")
            try:
                await self.client.write_gatt_char(uuid_1527, trigger_data, response=True)
                print("  OK - wrote to 0x1527")
            except Exception as e2:
                print(f"  Also failed on 0x1527: {e2}")
                
        await asyncio.sleep(0.2)
        
        # Check for indication
        if self.notifications:
            print(f"  Got {len(self.notifications)} notification(s)")
            for h, d, t in self.notifications:
                print(f"    {h}: {d.hex()} = '{t}'")
        
        # STEP 3: Send GIF data (capture used handle 0x0017 which was WriteCmd)
        # This should be 0x1525 (write-without-response)
        print(f"\nStep 3: Sending GIF data to 0x1525...")
        
        chunk_size = (self.client.mtu_size or 247) - 3
        total_chunks = (len(gif_data) + chunk_size - 1) // chunk_size
        
        start = time.time()
        for i in range(0, len(gif_data), chunk_size):
            chunk = gif_data[i:i+chunk_size]
            await self.client.write_gatt_char(uuid_1525, chunk, response=False)
            
            if (i // chunk_size + 1) % 50 == 0 or i + chunk_size >= len(gif_data):
                pct = min(100, int(((i + len(chunk)) / len(gif_data)) * 100))
                print(f"  [{pct:3d}%] chunk {i//chunk_size + 1}/{total_chunks}")
                
            await asyncio.sleep(0.005)
            
        elapsed = time.time() - start
        print(f"\nTransfer complete: {len(gif_data)} bytes in {elapsed:.2f}s")
        
        # Wait for response
        print("\nWaiting for device response...")
        await asyncio.sleep(2.0)
        
        print(f"\nNotifications received: {len(self.notifications)}")
        for h, d, t in self.notifications:
            print(f"  {h}: {d.hex()} = '{t}'")
            
        # Check result
        if any('complete' in t.lower() for h, d, t in self.notifications):
            print("\n*** SUCCESS! ***")
            return True
        elif any('fail' in t.lower() for h, d, t in self.notifications):
            print("\n[X] FAILED")
            return False
        else:
            print("\n[?] No clear result")
            return None


async def main():
    if len(sys.argv) < 2:
        print("Usage: python dott_upload_captured.py <gif_file>")
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
    await uploader.upload_captured_sequence(gif_data)
    await uploader.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
