import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreVerifyGate } from '../../src/foundation/PreVerifyGate';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock('https', () => ({
  request: requestMock,
}));

function createGate() {
  const ledger = {
    log: vi.fn().mockResolvedValue(undefined),
  };

  const gate = Object.create(PreVerifyGate.prototype) as any;
  gate.ledger = ledger;
  gate.cache = {} as any;

  return { gate, ledger };
}

function mockJinaRequest(kind: 'success' | 'timeout' | 'error', body = '') {
  return requestMock.mockImplementation((...args: any[]) => {
    const callback = args[2] as (res: EventEmitter & { headers: Record<string, unknown> }) => void;
    const res = new EventEmitter() as EventEmitter & { headers: Record<string, unknown>; statusCode: number };
    res.headers = {};
    res.statusCode = 200;

    const req = new EventEmitter() as any;
    req.setHeader = vi.fn();
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      queueMicrotask(() => {
        if (kind === 'success') {
          res.emit('data', Buffer.from(body));
          res.emit('end');
          return;
        }

        if (kind === 'timeout') {
          req.emit('timeout');
          return;
        }

        req.emit('error', new Error('socket hang up'));
      });
    });

    callback(res);
    return req;
  });
}

afterEach(() => {
  requestMock.mockReset();
  vi.restoreAllMocks();
});

describe('PreVerifyGate Jina telemetry', () => {
  it('logs CF_DETECTED as a failure for PIVA checks', async () => {
    const { gate, ledger } = createGate();
    mockJinaRequest('success', 'Checking your browser');

    const result = await (gate as any).checkJinaForPiva('https://example.com', '01234567890');

    expect(result).toBe('CF_DETECTED');
    expect(ledger.log).toHaveBeenCalledTimes(1);
    expect(ledger.log).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'CF_DETECTED',
      error_class: 'provider_block',
      punitive: true,
    }));
  });

  it('keeps MISS as a success when Jina returns content without an error', async () => {
    const { gate, ledger } = createGate();
    mockJinaRequest('success', 'plain body without the vat number');

    const result = await (gate as any).checkJinaForPiva('https://example.com', '01234567890');

    expect(result).toBe('MISS');
    expect(ledger.log).toHaveBeenCalledTimes(1);
    expect(ledger.log).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
    }));
    expect(ledger.log.mock.calls[0][0]).not.toHaveProperty('error');
  });

  it('logs semantic Jina timeouts as transport failures', async () => {
    const { gate, ledger } = createGate();
    mockJinaRequest('timeout');

    const result = await (gate as any).checkSemanticNameMatch('https://example.com', 'Example Srl');

    expect(result).toBe('MISS');
    expect(ledger.log).toHaveBeenCalledTimes(1);
    expect(ledger.log).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'TIMEOUT',
      error_class: 'transport',
      punitive: true,
    }));
  });

  it('logs network errors as transport failures for PIVA checks', async () => {
    const { gate, ledger } = createGate();
    mockJinaRequest('error');

    const result = await (gate as any).checkJinaForPiva('https://example.com', '01234567890');

    expect(result).toBe('MISS');
    expect(ledger.log).toHaveBeenCalledTimes(1);
    expect(ledger.log).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: 'NET_ERROR',
      error_class: 'transport',
      punitive: true,
    }));
  });
});
