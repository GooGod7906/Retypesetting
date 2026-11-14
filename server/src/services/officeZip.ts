import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as zlib from 'node:zlib';

// Word packages use local ZIP headers with sizes and CRCs already filled in.
const crc32 = (zlib as typeof zlib & { crc32(data: Buffer, seed?: number): number }).crc32;
const maxOffset = 0xffff_fffe;
const utf8Flag = 0x800;

interface OfficePart {
  name: string;
  size: number;
  crc: number;
  stream: () => Readable;
}

export function bufferPart(name: string, data: Buffer): OfficePart {
  return { name, size: data.length, crc: crc32(data), stream: () => Readable.from([data]) };
}

export async function streamPart(name: string, stream: () => Readable): Promise<OfficePart> {
  let size = 0;
  let crc = 0;
  for await (const chunk of stream()) {
    size += chunk.length;
    crc = crc32(chunk, crc);
  }
  return { name, size, crc, stream };
}

export async function writeOfficeZip(filename: string, parts: OfficePart[]): Promise<void> {
  if (parts.length >= 0xffff) throw new Error('Word 部件数量超出 ZIP 格式上限。');
  async function* chunks() {
    const directory: Buffer[] = [];
    let position = 0;
    for (const part of parts) {
      const name = Buffer.from(part.name, 'utf8');
      if (position + part.size + name.length + 30 > maxOffset || name.length > 0xffff) throw new Error('Word 文件超出 ZIP 格式上限。');
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(utf8Flag, 6);
      header.writeUInt16LE(33, 12);
      header.writeUInt32LE(part.crc, 14);
      header.writeUInt32LE(part.size, 18);
      header.writeUInt32LE(part.size, 22);
      header.writeUInt16LE(name.length, 26);

      const central = Buffer.alloc(46 + name.length);
      central.writeUInt32LE(0x02014b50);
      central.writeUInt16LE(20, 4);
      header.copy(central, 6, 4, 28);
      central.writeUInt32LE(position, 42);
      name.copy(central, 46);
      directory.push(central);

      yield header;
      yield name;
      let size = 0;
      let crc = 0;
      for await (const chunk of part.stream()) {
        size += chunk.length;
        if (size > part.size) throw new Error(`Word 部件长度不符：${part.name}`);
        crc = crc32(chunk, crc);
        yield chunk;
      }
      if (size !== part.size || crc !== part.crc) throw new Error(`Word 部件校验失败：${part.name}`);
      position += header.length + name.length + size;
    }
    let directorySize = 0;
    for (const central of directory) {
      directorySize += central.length;
      yield central;
    }
    if (position + directorySize + 22 > maxOffset) throw new Error('Word 文件超出 ZIP 格式上限。');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(parts.length, 8);
    end.writeUInt16LE(parts.length, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(position, 16);
    yield end;
  }
  await pipeline(Readable.from(chunks(), { objectMode: false }), createWriteStream(filename, { flags: 'wx' }));
}
