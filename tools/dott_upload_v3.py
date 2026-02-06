#!/usr/bin/env python3
"""
DOTT Upload v3 - Testing different trigger/data combinations
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
UUID_COMMAND = "00001526-0000-1000-8000-00805f9b34fb"
UUID_STATUS = "00001527-0000-1000-8000-00805f9b34fb"
UUID_ACK = "00001528-0000-1000-8000-00805f9b34fb"
UUID_DATA = "00001529-0000-1000-8000-00805f9b34fb"
UUID_RESPONSE = "00001530-0000-1000-8000-00805f9b34fb"

CHUNK_DELAY_MS = 10  # Increased delay


class DOTTTest:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.notifications = []
        
    def _notify(self, sender, data):
        text = data.decode('utf-8', errors='ignore')
        print(f"  [NOTIFY] {data.hex()} = '{text}'")
        self.notifications.append((sender, data, text))
        
    async def connect(self):
        self.client = BleakClient(self.address)
        await self.client.connect()
        print(f"Connected, MTU: {self.client.mtu_size}")
        
        # Enable all notifications
        for uuid in [UUID_DATA, UUID_RESPONSE, UUID_ACK]:
            try:
                await self.client.start_notify(uuid, self._notify)
            except:
                pass
                
        await asyncio.sleep(0.2)
        
    async def disconnect(self):
        await self.client.disconnect()
        
    async def read_char(self, uuid, name):
        try:
            data = await self.client.read_gatt_char(uuid)
            # Try to decode as text
            text = data.decode('utf-8', errors='ignore')[:20]
            print(f"  {name}: {data[:16].hex()}... ('{text}...')")
            return data
        except Exception as e:
            print(f"  {name}: Error - {e}")
            return None
            
    async def test_method(self, method_name, gif_data, trigger_func, data_func):
        """Test a specific upload method."""
        print(f"\n{'='*60}")
        print(f"Testing: {method_name}")
        print(f"{'='*60}")
        
        self.notifications.clear()
        
        # Read initial state
        print("\nInitial state:")
        await self.read_char(UUID_CONTROL, "Control")
        await self.read_char(UUID_STATUS, "Status")
        await self.read_char(UUID_RESPONSE, "Response")
        
        # Execute trigger
        print(f"\nTrigger phase:")
        await trigger_func(gif_data)
        await asyncio.sleep(0.3)  # Wait for device to respond
        
        # Check state after trigger
        print("\nAfter trigger:")
        await self.read_char(UUID_CONTROL, "Control")
        
        # Check if we got a failure notification already
        for _, data, text in self.notifications:
            if 'fail' in text.lower():
                print(f"\n[X] Already failed: '{text}'")
                return False
                
        # Execute data transfer
        print(f"\nData transfer phase:")
        success = await data_func(gif_data)
        
        await asyncio.sleep(1.0)
        
        # Final state
        print("\nFinal state:")
        await self.read_char(UUID_CONTROL, "Control")
        await self.read_char(UUID_RESPONSE, "Response")
        
        # Check notifications
        print(f"\nNotifications ({len(self.notifications)}):")
        for _, data, text in self.notifications:
            print(f"  {data.hex()} = '{text}'")
            
        # Check for success/failure
        for _, data, text in self.notifications:
            if 'complete' in text.lower() or 'success' in text.lower():
                print("\n[OK] SUCCESS!")
                return True
            if 'fail' in text.lower():
                print(f"\n[X] FAILED: '{text}'")
                return False
                
        print("\n[?] No clear success/failure notification")
        return None


async def main():
    if len(sys.argv) < 2:
        print("Usage: python dott_upload_v3.py <gif_file>")
        return
        
    with open(sys.argv[1], 'rb') as f:
        gif_data = f.read()
    print(f"Loaded: {sys.argv[1]} ({len(gif_data)} bytes)")
    
    # Find device
    print("Scanning...")
    devices = await BleakScanner.discover(timeout=5.0)
    dott = [d for d in devices if d.name and "dott" in d.name.lower()]
    if not dott:
        print("No DOTT found!")
        return
    address = dott[0].address
    print(f"Found: {address}")
    
    tester = DOTTTest(address)
    await tester.connect()
    
    mtu = tester.client.mtu_size or 23
    chunk_size = mtu - 3
    
    # ========================================
    # METHOD 1: Size to Control, Data to Data (what we tried)
    # ========================================
    async def m1_trigger(data):
        size_header = struct.pack('<I', len(data))
        print(f"  Writing size {len(data)} to Control (0x1525)")
        await tester.client.write_gatt_char(UUID_CONTROL, size_header, response=False)
        
    async def m1_data(data):
        print(f"  Streaming {len(data)} bytes to Data (0x1529)")
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            await tester.client.write_gatt_char(UUID_DATA, chunk, response=True)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
        return True
        
    # await tester.test_method("M1: Size->Control, Data->Data", gif_data, m1_trigger, m1_data)
    
    # ========================================
    # METHOD 2: Size+Data all to Control (0x1525)
    # ========================================
    async def m2_trigger(data):
        # Just a small trigger or nothing
        pass
        
    async def m2_data(data):
        # Send size header first
        size_header = struct.pack('<I', len(data))
        print(f"  Writing size header to Control (0x1525)")
        await tester.client.write_gatt_char(UUID_CONTROL, size_header, response=False)
        await asyncio.sleep(0.1)
        
        # Then stream data to same characteristic
        print(f"  Streaming {len(data)} bytes to Control (0x1525)")
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            await tester.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
        return True
        
    # await tester.test_method("M2: Size+Data all to Control", gif_data, m2_trigger, m2_data)
    
    # ========================================
    # METHOD 3: Command char trigger, Data to Data
    # ========================================
    async def m3_trigger(data):
        size_header = struct.pack('<I', len(data))
        print(f"  Writing size {len(data)} to Command (0x1526)")
        try:
            await tester.client.write_gatt_char(UUID_COMMAND, size_header, response=True)
        except Exception as e:
            print(f"  Error: {e}")
        
    async def m3_data(data):
        print(f"  Streaming {len(data)} bytes to Data (0x1529)")
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            try:
                await tester.client.write_gatt_char(UUID_DATA, chunk, response=True)
            except:
                await tester.client.write_gatt_char(UUID_DATA, chunk, response=False)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
        return True
        
    # await tester.test_method("M3: Size->Command, Data->Data", gif_data, m3_trigger, m3_data)
    
    # ========================================
    # METHOD 4: Just raw data to Control (0x1525), NO size header
    # ========================================
    async def m4_trigger(data):
        pass
        
    async def m4_data(data):
        print(f"  Streaming {len(data)} bytes raw to Control (0x1525)")
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            await tester.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
        return True
        
    # await tester.test_method("M4: Raw data to Control only", gif_data, m4_trigger, m4_data)
    
    # ========================================
    # METHOD 5: Size to Command, then raw data to Control
    # ========================================
    async def m5_trigger(data):
        size_header = struct.pack('<I', len(data))
        print(f"  Writing size {len(data)} to Command (0x1526)")
        try:
            await tester.client.write_gatt_char(UUID_COMMAND, size_header, response=True)
        except Exception as e:
            print(f"  Error: {e}")
        
    async def m5_data(data):
        print(f"  Streaming {len(data)} bytes to Control (0x1525)")
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            await tester.client.write_gatt_char(UUID_CONTROL, chunk, response=False)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
        return True
        
    await tester.test_method("M5: Size->Command, Data->Control", gif_data, m5_trigger, m5_data)
    
    # ========================================
    # METHOD 6: Size prepended to data, all to Data char
    # ========================================
    async def m6_trigger(data):
        pass
        
    async def m6_data(data):
        # Prepend size to data
        full_data = struct.pack('<I', len(data)) + data
        print(f"  Streaming {len(full_data)} bytes (size+data) to Data (0x1529)")
        for i in range(0, len(full_data), chunk_size):
            chunk = full_data[i:i+chunk_size]
            try:
                await tester.client.write_gatt_char(UUID_DATA, chunk, response=True)
            except:
                await tester.client.write_gatt_char(UUID_DATA, chunk, response=False)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
        return True
        
    await tester.test_method("M6: Size+Data all to Data char", gif_data, m6_trigger, m6_data)
    
    await tester.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
