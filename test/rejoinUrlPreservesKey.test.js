import test from 'node:test';
import assert from 'node:assert/strict';

function buildRejoinUrl({ pathname, search, hash }) {
  const params = new URLSearchParams(search || '');
  params.delete('menu');
  const qs = params.toString();
  return qs ? `${pathname}?${qs}${hash || ''}` : `${pathname}${hash || ''}`;
}

test('rejoin url: removes menu but preserves key', () => {
  const url = buildRejoinUrl({
    pathname: '/'
    , search: '?menu=online&key=ABC123'
    , hash: ''
  });
  assert.equal(url, '/?key=ABC123');
});

test('rejoin url: preserves other params and hash', () => {
  const url = buildRejoinUrl({
    pathname: '/'
    , search: '?menu=online&key=ABC123&foo=bar'
    , hash: '#section'
  });
  assert.equal(url, '/?key=ABC123&foo=bar#section');
});

test('rejoin url: when menu is only param, becomes clean path', () => {
  const url = buildRejoinUrl({ pathname: '/', search: '?menu=online', hash: '' });
  assert.equal(url, '/');
});
