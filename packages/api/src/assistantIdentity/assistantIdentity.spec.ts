import { applyAssistantIdentity } from './index';

describe('applyAssistantIdentity', () => {
  it('adds the configured identity when no prompt exists', () => {
    expect(applyAssistantIdentity({ promptPrefix: null }, 'You are Cortex.')).toEqual({
      promptPrefix: 'You are Cortex.',
    });
  });

  it('keeps a conversation prompt after the configured identity', () => {
    expect(
      applyAssistantIdentity(
        { promptPrefix: 'Answer as a software architect.' },
        'You are Cortex.',
      ),
    ).toEqual({
      promptPrefix: 'You are Cortex.\n\nAnswer as a software architect.',
    });
  });

  it('does not duplicate an identity already applied to the conversation', () => {
    const conversation = {
      promptPrefix: 'You are Cortex.\n\nAnswer as a software architect.',
    };

    expect(applyAssistantIdentity(conversation, 'You are Cortex.')).toBe(conversation);
  });
});
