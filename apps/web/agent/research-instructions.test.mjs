import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTabelogRestaurantListing,
  restaurantResearchPrompt,
  restaurantSearchDescription,
} from './research-instructions.ts';

test('aggregate rating sources accept restaurant listings, not review or directory pages', () => {
  for (const path of [
    '/tokyo/A1307/A130702/13278678/',
    '/en/tokyo/A1307/A130702/13278678/',
  ]) {
    assert.equal(
      isTabelogRestaurantListing(`https://tabelog.com${path}`),
      true,
    );
  }
  for (const url of [
    'https://tabelog.com/tokyo/A1307/A130702/13278678/dtlrvwlst/B123/',
    'https://tabelog.com/rstLst/hamburger/',
    'https://tabelog.com.example.org/tokyo/A1307/A130702/13278678/',
    'https://user@tabelog.com/tokyo/A1307/A130702/13278678/',
    'http://tabelog.com/tokyo/A1307/A130702/13278678/',
  ])
    assert.equal(isTabelogRestaurantListing(url), false, url);
});

test('runtime instructions expose source precedence, limitations and confirmation boundary', () => {
  assert.match(restaurantResearchPrompt, /aggregate restaurant score/u);
  assert.match(restaurantResearchPrompt, /official website/u);
  assert.match(restaurantResearchPrompt, /fallback/u);
  assert.match(
    restaurantResearchPrompt,
    /populate them only from explicit source rules/u,
  );
  assert.match(restaurantResearchPrompt, /owner confirms separately/u);
  assert.match(restaurantSearchDescription, /never full pages/u);
});
