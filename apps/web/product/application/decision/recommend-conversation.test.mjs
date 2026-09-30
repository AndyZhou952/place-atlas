import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendRecommendChoice,
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

test('a selected geocoder candidate remains structured in the next request', () => {
  const first = { query: 'Good curry near me', replies: ['大久保駅'] };
  const chosen = appendRecommendChoice(
    first,
    '大久保駅',
    'Ōkubo Station, Shinjuku, Tokyo',
  );
  assert.deepEqual(chosen, {
    query: first.query,
    replies: ['大久保駅', 'Ōkubo Station, Shinjuku, Tokyo'],
    originChoice: {
      hint: '大久保駅',
      id: 'Ōkubo Station, Shinjuku, Tokyo',
    },
  });
  assert.deepEqual(appendRecommendReply(chosen, 'new starting point'), {
    query: first.query,
    replies: [
      '大久保駅',
      'Ōkubo Station, Shinjuku, Tokyo',
      'new starting point',
    ],
  });
  assert.equal(
    parseRecommendConversationInput({
      ...chosen,
      originChoice: { hint: '大久保駅', id: 'Other place' },
    }),
    undefined,
  );
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
