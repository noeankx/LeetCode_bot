import struct
import zlib

def make_png():
    width = 128
    height = 128
    
    # PNG Header
    header = b'\x89PNG\r\n\x1a\n'
    
    # IHDR Chunk
    ihdr_data = struct.pack('!IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
    ihdr = struct.pack('!I', len(ihdr_data)) + b'IHDR' + ihdr_data + struct.pack('!I', ihdr_crc)
    
    # IDAT Chunk (Image Data) - simple green block
    raw_data = b'\x00' + (b'\x00\xff\x00' * width) * height
    compressed_data = zlib.compress(raw_data)
    idat_crc = zlib.crc32(b'IDAT' + compressed_data) & 0xffffffff
    idat = struct.pack('!I', len(compressed_data)) + b'IDAT' + compressed_data + struct.pack('!I', idat_crc)
    
    # IEND Chunk
    iend_crc = zlib.crc32(b'IEND') & 0xffffffff
    iend = struct.pack('!I', 0) + b'IEND' + struct.pack('!I', iend_crc)
    
    with open('icon.png', 'wb') as f:
        f.write(header + ihdr + idat + iend)
    print("icon.png created successfully")

if __name__ == '__main__':
    make_png()
