import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createRangeSliceStream } from '../src/main/server/mediaTransforms';

describe('createRangeSliceStream (FongMi Range pattern)', () => {
  it('skips initial bytes and emits the requested slice length', async () => {
    // 100 bytes input: 0..99
    const input = Buffer.from(Array.from({ length: 100 }, (_, i) => i));
    const stream = Readable.from([input]);
    const slice = createRangeSliceStream(10, 20); // skip 10, emit 20 (bytes 10..29)

    const chunks: Buffer[] = [];
    for await (const chunk of stream.pipe(slice)) {
      chunks.push(chunk as Buffer);
    }
    const result = Buffer.concat(chunks);
    expect(result.length).toBe(20);
    expect(result[0]).toBe(10);
    expect(result[19]).toBe(29);
  });

  it('handles small chunk boundaries correctly across skips', async () => {
    // 5 chunks of 10 bytes each
    const chunksIn = Array.from({ length: 5 }, (_, chunkIdx) =>
      Buffer.from(Array.from({ length: 10 }, (_, byteIdx) => chunkIdx * 10 + byteIdx)),
    );
    const stream = Readable.from(chunksIn);
    // skip 15 bytes (middle of chunk 1), take 12 bytes
    const slice = createRangeSliceStream(15, 12);

    const chunksOut: Buffer[] = [];
    for await (const chunk of stream.pipe(slice)) {
      chunksOut.push(chunk as Buffer);
    }
    const result = Buffer.concat(chunksOut);
    expect(result.length).toBe(12);
    expect(result[0]).toBe(15);
    expect(result[11]).toBe(26);
  });
});
