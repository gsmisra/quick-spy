import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildDocxPreview, extractDocxSegment, splitMarkdownIntoSections } from '../../src/agentic/docxIngestion';
import { AgenticDocxData } from '../../src/agentic/agenticTypes';

test('splitMarkdownIntoSections splits on ATX headings of any level', () => {
  const markdown = '# Login Flow\nEnter credentials.\n\n## Sub step\nClick submit.\n\n# Checkout\nPay for the order.';
  const sections = splitMarkdownIntoSections(markdown);
  assert.deepEqual(
    sections.map((s) => ({ heading: s.heading, level: s.level })),
    [
      { heading: 'Login Flow', level: 1 },
      { heading: 'Sub step', level: 2 },
      { heading: 'Checkout', level: 1 }
    ]
  );
  assert.equal(sections[0].text, 'Enter credentials.');
  assert.equal(sections[2].text, 'Pay for the order.');
});

test('splitMarkdownIntoSections keeps text before the first heading as a heading-less section', () => {
  const markdown = 'Intro paragraph with no heading.\n\n# First Heading\nBody text.';
  const sections = splitMarkdownIntoSections(markdown);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].heading, '');
  assert.equal(sections[0].text, 'Intro paragraph with no heading.');
  assert.equal(sections[1].heading, 'First Heading');
});

test('splitMarkdownIntoSections on a document with no headings at all returns one section holding everything', () => {
  const markdown = 'Just a plain document.\nNo headings anywhere.\nSecond line of prose.';
  const sections = splitMarkdownIntoSections(markdown);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, '');
  assert.equal(sections[0].level, 0);
  assert.match(sections[0].text, /Just a plain document/);
  assert.match(sections[0].text, /Second line of prose/);
});

test('splitMarkdownIntoSections on an empty document returns nothing', () => {
  assert.deepEqual(splitMarkdownIntoSections(''), []);
  assert.deepEqual(splitMarkdownIntoSections('   \n  \n'), []);
});

test('buildDocxPreview lists only the headed sections, in order, with their levels', () => {
  const data: AgenticDocxData = {
    sections: [
      { heading: '', level: 0, text: 'preamble' },
      { heading: 'A', level: 1, text: 'a text' },
      { heading: 'B', level: 2, text: 'b text' }
    ]
  };
  assert.deepEqual(buildDocxPreview(data), {
    headings: [
      { text: 'A', level: 1 },
      { text: 'B', level: 2 }
    ]
  });
});

const THREE_SECTION_DOC: AgenticDocxData = {
  sections: [
    { heading: 'Login Flow', level: 1, text: 'Enter credentials and submit.' },
    { heading: 'Search', level: 1, text: 'Search for a product.' },
    { heading: 'Checkout', level: 1, text: 'Pay for the order.' }
  ]
};

test('extractDocxSegment with no headingRange configured sends the whole document', () => {
  const segment = extractDocxSegment('reqs.docx', THREE_SECTION_DOC, {});
  assert.match(segment.text, /Login Flow/);
  assert.match(segment.text, /Search/);
  assert.match(segment.text, /Checkout/);
});

test('extractDocxSegment restricts to the configured 1-based heading index range', () => {
  const segment = extractDocxSegment('reqs.docx', THREE_SECTION_DOC, { headingRange: { fromIndex: 2, toIndex: 2 } });
  assert.doesNotMatch(segment.text, /Login Flow/);
  assert.match(segment.text, /Search/);
  assert.doesNotMatch(segment.text, /Checkout/);
});

test('extractDocxSegment on a document with no headings always sends the full text regardless of headingRange', () => {
  const noHeadings: AgenticDocxData = { sections: [{ heading: '', level: 0, text: 'Just plain unheaded text.' }] };
  const segment = extractDocxSegment('plain.docx', noHeadings, { headingRange: { fromIndex: 1, toIndex: 1 } });
  assert.match(segment.text, /Just plain unheaded text/);
});
