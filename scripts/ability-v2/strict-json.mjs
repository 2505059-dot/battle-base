const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function parseStrictJson(text, source = '<json>') {
  let index = 0;
  const fail = (message) => { throw new Error(source + ': ' + message + ' at byte offset ' + index); };
  const whitespace = () => { while (index < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[index])) index += 1; };
  const string = () => {
    const start = index;
    if (text[index] !== '"') fail('expected a JSON string');
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '\\') { index += 2; continue; }
      if (character === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      }
      if (character.charCodeAt(0) < 0x20) fail('unescaped control character in JSON string');
      index += 1;
    }
    fail('unterminated JSON string');
  };
  const value = () => {
    whitespace();
    const character = text[index];
    if (character === '{') {
      index += 1; whitespace();
      const keys = new Set();
      if (text[index] === '}') { index += 1; return; }
      while (index < text.length) {
        whitespace();
        const keyOffset = index;
        const key = string();
        if (keys.has(key)) fail('duplicate object property ' + JSON.stringify(key) + ' (first seen before offset ' + keyOffset + ')');
        keys.add(key);
        whitespace();
        if (text[index] !== ':') fail('expected colon after object property');
        index += 1; value(); whitespace();
        if (text[index] === '}') { index += 1; return; }
        if (text[index] !== ',') fail('expected comma or closing brace');
        index += 1;
      }
      fail('unterminated JSON object');
    }
    if (character === '[') {
      index += 1; whitespace();
      if (text[index] === ']') { index += 1; return; }
      while (index < text.length) {
        value(); whitespace();
        if (text[index] === ']') { index += 1; return; }
        if (text[index] !== ',') fail('expected comma or closing bracket');
        index += 1;
      }
      fail('unterminated JSON array');
    }
    if (character === '"') { string(); return; }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, index)) { index += literal.length; return; }
    }
    numberToken.lastIndex = index;
    const match = numberToken.exec(text);
    if (match) { index = numberToken.lastIndex; return; }
    fail('expected a JSON value');
  };
  value(); whitespace();
  if (index !== text.length) fail('unexpected trailing content');
  return JSON.parse(text);
}

export function verifyStrictJsonFixtures() {
  const valid = parseStrictJson('{"outer":{"a":1,"text":"escaped \\"a\\" text"}}', 'fixture');
  if (valid.outer.a !== 1 || valid.outer.text !== 'escaped "a" text') throw new Error('Strict JSON valid-string fixture failed.');
  const duplicates = [
    '{"key":1,"key":2}',
    '{"key":1,"\\u006bey":2}',
    '{"nested":{"key":1,"key":2}}'
  ];
  for (const input of duplicates) {
    let rejected = false;
    try { parseStrictJson(input, 'duplicate-key fixture'); } catch (error) { rejected = /duplicate object property/.test(error.message); }
    if (!rejected) throw new Error('Strict JSON duplicate-property fixture was accepted.');
  }
  return 4;
}
