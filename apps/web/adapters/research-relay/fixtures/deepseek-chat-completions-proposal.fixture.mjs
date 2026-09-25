export const deepSeekChatCompletionsProposalFixture = {
  id: 'ea81cf81-3f10-4e72-a508-75e1559f2e19',
  object: 'chat.completion',
  created: 1_796_000_000,
  model: 'deepseek-flash',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: JSON.stringify({
          status: 'proposal',
          subjectMatch: 'matched',
          proposal: {
            tabelog: {
              status: 'known',
              score: 3.97,
              reviewCount: 1629,
              url: 'https://tabelog.com/tokyo/A1307/A130702/13250789/',
            },
            reservation: { status: 'unknown' },
          },
        }),
      },
      logprobs: null,
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 450,
    completion_tokens: 56,
    total_tokens: 506,
  },
  system_fingerprint: 'fp_fixture',
};
