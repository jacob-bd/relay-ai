import { describe, expect, it } from 'vitest';
import {
  hostFromHeader,
  isLoopbackHost,
  parseAdvertiseHostsFromEnv,
  resolveAdvertiseAddresses,
  resolveAdvertiseGatewayPort,
} from '../src/server/advertise-addrs.js';

describe('advertise-addrs', () => {
  it('parses Host headers with and without ports', () => {
    expect(hostFromHeader('192.168.1.10:8787')).toBe('192.168.1.10');
    expect(hostFromHeader('example.local')).toBe('example.local');
    expect(hostFromHeader('[::1]:8787')).toBe('::1');
  });

  it('detects loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
  });

  it('parses RELAY_AI_ADVERTISE_HOST / HOSTS', () => {
    expect(parseAdvertiseHostsFromEnv({ RELAY_AI_ADVERTISE_HOST: '192.168.1.10' }))
      .toEqual(['192.168.1.10']);
    expect(parseAdvertiseHostsFromEnv({ RELAY_AI_ADVERTISE_HOSTS: '10.0.0.1, 10.0.0.2' }))
      .toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('prefers env + request Host over empty NIC list when provided', () => {
    const addrs = resolveAdvertiseAddresses({
      requestHost: '192.168.68.5',
      env: { RELAY_AI_ADVERTISE_HOST: '10.0.0.5' },
    });
    expect(addrs.map(a => a.address)).toEqual(['10.0.0.5', '192.168.68.5']);
  });

  it('uses request Host alone when env is unset', () => {
    const addrs = resolveAdvertiseAddresses({
      requestHost: '192.168.68.5',
      env: {},
    });
    expect(addrs).toEqual([{ name: 'LAN', address: '192.168.68.5' }]);
  });

  it('ignores loopback request Host', () => {
    const addrs = resolveAdvertiseAddresses({
      requestHost: '127.0.0.1',
      env: {},
    });
    expect(addrs.every(a => a.address !== '127.0.0.1')).toBe(true);
  });

  it('resolves the host-published gateway port for URL cards', () => {
    expect(resolveAdvertiseGatewayPort(17645, {})).toBe(17645);
    expect(resolveAdvertiseGatewayPort(17645, { RELAY_AI_GATEWAY_HOST_PORT: '17646' })).toBe(17646);
    expect(resolveAdvertiseGatewayPort(17645, { RELAY_AI_ADVERTISE_GATEWAY_PORT: '18000' })).toBe(18000);
    expect(resolveAdvertiseGatewayPort(17645, { RELAY_AI_GATEWAY_HOST_PORT: 'nope' })).toBe(17645);
  });
});
