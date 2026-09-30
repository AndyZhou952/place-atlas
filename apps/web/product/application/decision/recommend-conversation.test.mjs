import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendRecommendReply,
  parseRecommendConversationInput,
} from './recommend-conversation.ts';

test('clarification reply keeps the original request and prior answers', () => {
  const initial = parseRecommendConversationInput({
    query: '  新宿で徒歩10分の焼き鳥  ',
    replies: [],
  });
  assert.deepEqual(initial, {
    query: '新宿で徒歩10分の焼き鳥',
    replies: [],
  });
  const continued = appendRecommendReply(initial, '  新宿三丁目駅  ');
  assert.deepEqual(continued, {
    query: '新宿で徒歩10分の焼き鳥',
    replies: ['新宿三丁目駅'],
  });
});

test('empty, oversized and too many follow-up answers fail before model work', () => {
  assert.equal(
    parseRecommendConversationInput({ query: '', replies: [] }),
    undefined,
  );
  assert.equal(
    parseRecommendConversationInput({ query: 'food', replies: [''] }),
    undefined,
  );
  assert.equal(
    parseRecommendConversationInput({
      query: 'food',
      replies: Array(4).fill('answer'),
    }),
    undefined,
  );
  assert.equal(
    parseRecommendConversationInput({
      query: 'food',
      replies: ['a'.repeat(301)],
    }),
    undefined,
  );
});
