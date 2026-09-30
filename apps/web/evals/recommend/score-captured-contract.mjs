import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { scoreRecommendContract } from './score-contract.mjs';

export function materializeContract(gold, bindings, catalog) {
  if (Object.keys(bindings.cases).length !== gold.cases.length)
    throw new Error('Incomplete contract bindings');
  return {
    ...gold,
    datasetId: `${gold.datasetId}-deployed`,
    cases: gold.cases.map((entry) => {
      const binding = bindings.cases[entry.caseId];
      if (!binding) throw new Error('Missing contract binding');
      const expected = { ...entry.expected };
      if (binding.sourceUrl) {
        const matches = catalog.filter(
          (item) =>
            item.kind === 'food' &&
            item.verificationStatus === 'verified' &&
            item.tabelog?.url === binding.sourceUrl,
        );
        if (matches.length !== 1)
          throw new Error('Expected catalog identity is not unique');
        const item = matches[0];
        Object.assign(expected, {
          itemId: item.id,
          detailTargetId: item.id,
          name: item.title,
          address: item.address,
        });
      }
      const answers = binding.answers ?? entry.answers;
      if (expected.secondClarification === 'origin_choice')
        expected.choiceId = answers[1];
      return {
        ...entry,
        query: binding.query ?? entry.query,
        answers,
        expected,
        scenario: binding.scenario,
      };
    }),
  };
}

export function scoreCapturedContract(dataset, records, observations, catalog) {
  const predictions = dataset.cases
    .map((entry) => {
      const ui = observations.find(
        (observation) => observation.caseId === entry.caseId,
      );
      if (!ui) return undefined;
      const wanted = [{ query: entry.query, replies: [] }];
      if (entry.expected.resetBeforeAnswer)
        wanted.push({ query: entry.answers[0], replies: [] });
      else
        for (let i = 1; i <= entry.answers.length; i++)
          wanted.push({
            query: entry.query,
            replies: entry.answers.slice(0, i),
            ...(i === 2 &&
            entry.expected.secondClarification === 'origin_choice'
              ? {
                  originChoice: {
                    hint: entry.expected.choiceHint,
                    id: entry.expected.choiceId,
                  },
                }
              : {}),
          });
      const scoped = records.filter(
        (record) => record.scenario === entry.scenario,
      );
      let captured;
      for (let start = 0; start <= scoped.length - wanted.length; start++) {
        const candidate = scoped.slice(start, start + wanted.length);
        if (
          candidate.every(
            (record, index) =>
              JSON.stringify(record.request) === JSON.stringify(wanted[index]),
          )
        )
          captured = candidate;
      }
      if (!captured) return undefined;
      for (const record of captured) {
        if (record.httpStatus !== 200)
          throw new Error('Captured API request failed');
        for (const recommendation of record.response.recommendations ?? []) {
          const item = catalog.find(
            (item) => item.id === recommendation.itemId,
          );
          if (
            !item ||
            item.kind !== 'food' ||
            item.verificationStatus !== 'verified' ||
            item.title !== recommendation.name ||
            item.address !== recommendation.address ||
            recommendation.detailTargetId !== item.id
          )
            throw new Error('Noncanonical saved recommendation');
        }
      }
      if (
        entry.scenario === 'provider-failure' &&
        !captured.some((record) => record.routeCalls > 0)
      )
        throw new Error('Provider failure was not exercised');
      return {
        caseId: entry.caseId,
        trace: {
          ...ui,
          requests: captured.map((record) => record.request),
          responses: captured.map((record) => record.response),
        },
      };
    })
    .filter(Boolean);
  return scoreRecommendContract(dataset, {
    datasetId: dataset.datasetId,
    predictions,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const directory = process.argv[2];
  if (!directory) throw new Error('Provide a capture directory');
  const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
  const catalog = await json(`${directory}/catalog.json`);
  const gold = await json(new URL('./contract-gold.v1.json', import.meta.url));
  const bindings = await json(
    new URL('./deployed-contract-bindings.json', import.meta.url),
  );
  const dataset = materializeContract(gold, bindings, catalog);
  const records = [];
  for (const scenario of new Set(
    dataset.cases.map((entry) => entry.scenario),
  )) {
    const text = await readFile(
      `${directory}/browser-${scenario}.jsonl`,
      'utf8',
    );
    records.push(
      ...text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );
  }
  const report = scoreCapturedContract(
    dataset,
    records,
    await json(`${directory}/browser-observations.json`),
    catalog,
  );
  await writeFile(
    `${directory}/contract-score.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passes ? 0 : 1;
}
