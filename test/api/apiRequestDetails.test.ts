import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { extractApiBodyFieldNames, hasApiRequest, ApiRequestDetails } from '../../src/api/apiRequestDetails';

function baseDetails(overrides: Partial<ApiRequestDetails> = {}): ApiRequestDetails {
  return {
    method: 'POST',
    url: 'https://api.example.com/orders',
    params: [],
    headers: [],
    authType: 'noauth',
    auth: {
      apiKeyName: '',
      apiKeyValue: '',
      apiKeyAddTo: 'header',
      bearerToken: '',
      basicUsername: '',
      basicPassword: '',
      digestUsername: '',
      digestPassword: '',
      oauth1ConsumerKey: '',
      oauth1ConsumerSecret: '',
      oauth1AccessToken: '',
      oauth1TokenSecret: '',
      oauth1SignatureMethod: '',
      oauth2AccessToken: '',
      oauth2HeaderPrefix: '',
      hawkAuthId: '',
      hawkAuthKey: '',
      hawkAlgorithm: '',
      awsAccessKey: '',
      awsSecretKey: '',
      awsSessionToken: '',
      awsRegion: '',
      awsServiceName: '',
      ntlmUsername: '',
      ntlmPassword: '',
      ntlmDomain: '',
      ntlmWorkstation: '',
      edgeGridAccessToken: '',
      edgeGridClientToken: '',
      edgeGridClientSecret: ''
    },
    bodyMode: 'none',
    bodyFormFields: [],
    bodyUrlencodedFields: [],
    bodyRawLanguage: 'json',
    bodyRaw: '',
    ...overrides
  };
}

test('extracts field names from a form-data body', () => {
  const details = baseDetails({
    bodyMode: 'form-data',
    bodyFormFields: [
      { key: 'cardNumber', value: '4111111111111111', description: '', valueType: 'text' },
      { key: 'expiryDate', value: '12/30', description: '', valueType: 'text' }
    ]
  });
  assert.deepEqual(extractApiBodyFieldNames(details).sort(), ['cardNumber', 'expiryDate']);
});

test('extracts field names from an x-www-form-urlencoded body', () => {
  const details = baseDetails({
    bodyMode: 'x-www-form-urlencoded',
    bodyUrlencodedFields: [{ key: 'customerId', value: 'secret-looking-value', description: '' }]
  });
  assert.deepEqual(extractApiBodyFieldNames(details), ['customerId']);
});

test('extracts top-level AND nested keys from a valid JSON raw body', () => {
  const details = baseDetails({
    bodyMode: 'raw',
    bodyRaw: JSON.stringify({ customerId: 'c1', payment: { cardNumber: '4111', cvv: '123' } })
  });
  assert.deepEqual(extractApiBodyFieldNames(details).sort(), ['cardNumber', 'customerId', 'cvv', 'payment']);
});

test('extracts keys from objects nested inside a JSON array', () => {
  const details = baseDetails({
    bodyMode: 'raw',
    bodyRaw: JSON.stringify({ items: [{ sku: 'A1' }, { sku: 'A2', quantity: 2 }] })
  });
  assert.deepEqual(extractApiBodyFieldNames(details).sort(), ['items', 'quantity', 'sku']);
});

test('NEVER includes field VALUES, only names — a value that looks like a field name is not mistaken for one', () => {
  const details = baseDetails({
    bodyMode: 'raw',
    bodyRaw: JSON.stringify({ password: 'totallySecretValue123' })
  });
  const names = extractApiBodyFieldNames(details);
  assert.deepEqual(names, ['password']);
  assert.ok(!names.includes('totallySecretValue123'));
});

test('a malformed (non-JSON) raw body extracts nothing rather than guessing', () => {
  const details = baseDetails({ bodyMode: 'raw', bodyRaw: '<xml><cardNumber>4111</cardNumber></xml>' });
  assert.deepEqual(extractApiBodyFieldNames(details), []);
});

test('bodyMode "none" extracts nothing', () => {
  const details = baseDetails({ bodyMode: 'none' });
  assert.deepEqual(extractApiBodyFieldNames(details), []);
});

test('an empty raw body extracts nothing without throwing', () => {
  const details = baseDetails({ bodyMode: 'raw', bodyRaw: '   ' });
  assert.deepEqual(extractApiBodyFieldNames(details), []);
});

test('duplicate field names across nesting levels are de-duplicated', () => {
  const details = baseDetails({
    bodyMode: 'raw',
    bodyRaw: JSON.stringify({ id: 1, nested: { id: 2, deeper: { id: 3 } } })
  });
  assert.deepEqual(extractApiBodyFieldNames(details), ['id', 'nested', 'deeper']);
});

test('a JSON array at the top level is handled without throwing', () => {
  const details = baseDetails({ bodyMode: 'raw', bodyRaw: JSON.stringify([{ a: 1 }, { b: 2 }]) });
  assert.deepEqual(extractApiBodyFieldNames(details).sort(), ['a', 'b']);
});

test('hasApiRequest still works as before (unaffected by this change)', () => {
  assert.equal(hasApiRequest(baseDetails({ url: 'https://x.test' })), true);
  assert.equal(hasApiRequest(baseDetails({ url: '' })), false);
  assert.equal(hasApiRequest(undefined), false);
});
