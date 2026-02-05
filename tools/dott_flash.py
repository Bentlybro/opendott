#!/usr/bin/env python3
"""
DOTT Firmware Flash Tool
========================
Upload firmware to DOTT via MCUmgr SMP over BLE.

Usage:
    python dott_flash.py flash release2.0.bin
    python dott_flash.py info
    python dott_flash.py reset
"""

import asyncio
import argparse
import struct
import sys
import os
import hashlib

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print("Error: bleak not installed. Run: pip install bleak")
    sys.exit(1)

try:
    import cbor2
except ImportError:
    print("Error: cbor2 not installed. Run: pip install cbor2")
    sys.exit(1)

# MCUmgr SMP UUIDs
UUID_SMP_CHAR = "da2e7828-fbce-4e01-ae9e-261174997c48"

# SMP Constants
class SMPOp:
    READ = 0
    READ_RSP = 1
    WRITE = 2
    WRITE_RSP = 3

class SMPGroup:
    OS = 0
    IMAGE = 1

class SMPCmd:
    OS_RESET = 5
    IMG_STATE = 0
    IMG_UPLOAD = 1


def build_smp_packet(op, group, cmd_id, data=None, seq=0):
    """Build an SMP packet with CBOR payload."""
    if data is None:
        data = {}
    
    payload = cbor2.dumps(data)
    header = struct.pack('>BBHHBB', op, 0, len(payload), group, seq, cmd_id)
    return header + payload


def parse_smp_response(data):
    """Parse an SMP response packet."""
    if len(data) < 8:
        return None, None
    
    op, flags, length, group, seq, cmd = struct.unpack('>BBHHBB', data[:8])
    payload = data[8:8+length]
    
    try:
        result = cbor2.loads(payload) if payload else {}
    except:
        result = payload
    
    return {'op': op, 'group': group, 'cmd': cmd, 'seq': seq}, result


class DOTTFlasher:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.seq = 0
        self.responses = asyncio.Queue()
        
    async def connect(self):
        print(f"Connecting to {self.address}...")
        self.client = BleakClient(self.address)
        await self.client.connect()
        print(f"Connected: {self.client.is_connected}")
        
        # Enable notifications
        await self.client.start_notify(UUID_SMP_CHAR, self._notification_handler)
        print("SMP notifications enabled")
        
    async def disconnect(self):
        if self.client:
            await self.client.disconnect()
        print("Disconnected")
        
    def _notification_handler(self, sender, data):
        self.responses.put_nowait(data)
        
    async def smp_command(self, group, cmd, data=None, timeout=10.0):
        """Send SMP command and wait for response."""
        self.seq = (self.seq + 1) % 256
        packet = build_smp_packet(SMPOp.WRITE, group, cmd, data, self.seq)
        
        await self.client.write_gatt_char(UUID_SMP_CHAR, packet, response=False)
        
        try:
            response = await asyncio.wait_for(self.responses.get(), timeout)
            _, result = parse_smp_response(response)
            return result
        except asyncio.TimeoutError:
            return None
            
    async def get_image_state(self):
        """Get current firmware image state."""
        return await self.smp_command(SMPGroup.IMAGE, SMPCmd.IMG_STATE)
        
    async def reset(self):
        """Reset the device."""
        print("Sending reset command...")
        return await self.smp_command(SMPGroup.OS, SMPCmd.OS_RESET)
        
    async def upload_firmware(self, firmware_path):
        """Upload firmware image via MCUmgr."""
        print(f"\n{'='*60}")
        print("FIRMWARE UPLOAD")
        print('='*60)
        
        with open(firmware_path, 'rb') as f:
            firmware_data = f.read()
            
        total_size = len(firmware_data)
        sha256 = hashlib.sha256(firmware_data).digest()
        
        print(f"Firmware: {firmware_path}")
        print(f"Size: {total_size} bytes ({total_size/1024:.1f} KB)")
        print(f"SHA256: {sha256.hex()[:16]}...")
        print()
        
        # MCUmgr image upload uses chunked transfer
        # Each chunk has: image number, offset, data, and optionally length + sha for first chunk
        
        chunk_size = 128  # Conservative for BLE MTU
        offset = 0
        image_num = 0  # Slot 0 for main image
        
        while offset < total_size:
            chunk = firmware_data[offset:offset + chunk_size]
            
            # Build upload request
            req = {
                "image": image_num,
                "off": offset,
                "data": chunk,
            }
            
            # First chunk includes total length and hash
            if offset == 0:
                req["len"] = total_size
                req["sha"] = sha256
                
            # Progress
            progress = (offset / total_size) * 100
            print(f"\rUploading: {progress:5.1f}% ({offset}/{total_size} bytes)", end="", flush=True)
            
            # Send chunk
            result = await self.smp_command(SMPGroup.IMAGE, SMPCmd.IMG_UPLOAD, req, timeout=30)
            
            if result is None:
                print(f"\n\nError: No response at offset {offset}")
                return False
                
            rc = result.get('rc', -1)
            if rc != 0:
                print(f"\n\nError: Upload failed with rc={rc} at offset {offset}")
                print(f"Response: {result}")
                return False
                
            # Get next offset from response (device tells us where to continue)
            next_off = result.get('off', offset + len(chunk))
            offset = next_off
            
            await asyncio.sleep(0.01)  # Small delay
            
        print(f"\rUploading: 100.0% ({total_size}/{total_size} bytes)")
        print("\n✓ Upload complete!")
        
        # Verify
        print("\nVerifying...")
        state = await self.get_image_state()
        if state:
            print(f"Image state: {state}")
            
        return True
        
    async def confirm_image(self):
        """Confirm the uploaded image (make it permanent)."""
        # Image confirm uses a different command
        req = {"confirm": True}
        return await self.smp_command(SMPGroup.IMAGE, SMPCmd.IMG_STATE, req)


async def scan_for_dott():
    """Scan for DOTT devices."""
    print("Scanning for DOTT devices...")
    devices = await BleakScanner.discover(timeout=5.0)
    
    for d in devices:
        name = d.name or "Unknown"
        if "dott" in name.lower():
            print(f"Found: {d.address} - {name}")
            return d.address
            
    print("No DOTT device found")
    return None


async def cmd_info(address):
    """Show device info."""
    flasher = DOTTFlasher(address)
    try:
        await flasher.connect()
        
        print("\nImage State:")
        state = await flasher.get_image_state()
        if state:
            if 'images' in state:
                for img in state['images']:
                    slot = img.get('slot', '?')
                    ver = img.get('version', '?.?.?')
                    active = '✓' if img.get('active') else ' '
                    confirmed = '✓' if img.get('confirmed') else ' '
                    print(f"  Slot {slot}: v{ver} [active:{active}] [confirmed:{confirmed}]")
            else:
                print(f"  {state}")
        else:
            print("  No response")
            
    finally:
        await flasher.disconnect()


async def cmd_flash(address, firmware_path):
    """Flash firmware to device."""
    if not os.path.exists(firmware_path):
        print(f"Error: File not found: {firmware_path}")
        return
        
    flasher = DOTTFlasher(address)
    try:
        await flasher.connect()
        
        success = await flasher.upload_firmware(firmware_path)
        
        if success:
            print("\n" + "="*60)
            print("IMPORTANT: To activate the new firmware:")
            print("  1. Reset the device (power cycle or use 'reset' command)")
            print("  2. The new firmware will boot")
            print("  3. If it works, confirm it to make permanent")
            print("="*60)
            
            answer = input("\nReset device now? [y/N]: ")
            if answer.lower() == 'y':
                await flasher.reset()
                print("Device is resetting...")
                
    finally:
        await flasher.disconnect()


async def cmd_reset(address):
    """Reset the device."""
    flasher = DOTTFlasher(address)
    try:
        await flasher.connect()
        await flasher.reset()
        print("Device is resetting...")
    finally:
        await flasher.disconnect()


async def main():
    parser = argparse.ArgumentParser(description="DOTT Firmware Flash Tool")
    parser.add_argument('command', choices=['info', 'flash', 'reset'])
    parser.add_argument('file', nargs='?', help='Firmware file for flash command')
    parser.add_argument('-a', '--address', help='Device address')
    
    args = parser.parse_args()
    
    address = args.address or await scan_for_dott()
    if not address:
        return
        
    if args.command == 'info':
        await cmd_info(address)
    elif args.command == 'flash':
        if not args.file:
            print("Error: flash requires firmware file")
            return
        await cmd_flash(address, args.file)
    elif args.command == 'reset':
        await cmd_reset(address)


if __name__ == '__main__':
    asyncio.run(main())
