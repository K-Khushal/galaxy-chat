'use client';

import {
    Action,
    Actions
} from '@/components/elements/actions';
import {
    Conversation,
    ConversationContent,
    ConversationScrollButton,
} from '@/components/elements/conversation';
import { Loader } from '@/components/elements/loader';
import { Message, MessageContent } from '@/components/elements/message';
import {
    PromptInput,
    PromptInputActionAddAttachments,
    PromptInputActionMenu,
    PromptInputActionMenuContent,
    PromptInputActionMenuTrigger,
    PromptInputAttachment,
    PromptInputAttachments,
    PromptInputBody,
    PromptInputButton,
    type PromptInputMessage,
    PromptInputModelSelect,
    PromptInputModelSelectContent,
    PromptInputModelSelectItem,
    PromptInputModelSelectTrigger,
    PromptInputModelSelectValue,
    PromptInputSubmit,
    PromptInputTextarea,
    PromptInputToolbar,
    PromptInputTools,
} from '@/components/elements/prompt-input';
import {
    Reasoning,
    ReasoningContent,
    ReasoningTrigger,
} from '@/components/elements/reasoning';
import { Response } from '@/components/elements/response';
import {
    Source,
    Sources,
    SourcesContent,
    SourcesTrigger,
} from '@/components/elements/sources';
import { useChat } from '@ai-sdk/react';
import { CopyIcon, RefreshCcwIcon } from 'lucide-react';
import { Fragment, useState } from 'react';

const models = [
    {
        name: 'Grok 4 Fast',
        value: 'x-ai/grok-4-fast:free',
    },
    {
        name: 'Deepseek R1',
        value: 'deepseek/deepseek-r1:free',
    },
    {
        name: 'GPT OSS 120B',
        value: 'openai/gpt-oss-120b:free',
    },
    {
        name: 'Gemini 2.0 Flash Exp',
        value: 'google/gemini-2.0-flash-exp:free',
    },

];

const ChatBotDemo = () => {
    const [input, setInput] = useState('');
    const [model, setModel] = useState<string>(models[0].value);
    const [webSearch, setWebSearch] = useState(false);
    const { messages, sendMessage, status } = useChat();

    const retryLast = () => {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        const text = lastUser?.parts?.filter((p) => p.type === 'text').map((p: any) => p.text).join('\n') || '';
        if (!text) return;
        sendMessage(
            { text },
            { body: { model, webSearch } }
        );
    };

    const handleSubmit = (message: PromptInputMessage) => {
        const hasText = Boolean(message.text);
        const hasAttachments = Boolean(message.files?.length);

        if (!(hasText || hasAttachments)) {
            return;
        }

        sendMessage(
            {
                text: message.text || 'Sent with attachments',
                files: message.files
            },
            {
                body: {
                    model: model,
                    webSearch: webSearch,
                },
            },
        );
        setInput('');
    };

    return (
        <div className="max-w-4xl mx-auto p-6 relative size-full h-full overscroll-none">
            <div className="flex flex-col h-full">
                <Conversation className="h-full">
                    <ConversationContent>
                        {messages.map((message) => (
                            <div key={message.id}>
                                {message.role === 'assistant' && message.parts.filter((part) => part.type === 'source-url').length > 0 && (
                                    <Sources>
                                        <SourcesTrigger
                                            count={
                                                message.parts.filter(
                                                    (part) => part.type === 'source-url',
                                                ).length
                                            }
                                        />
                                        {message.parts.filter((part) => part.type === 'source-url').map((part, i) => (
                                            <SourcesContent key={`${message.id}-${i}`}>
                                                <Source
                                                    key={`${message.id}-${i}`}
                                                    href={part.url}
                                                    title={part.url}
                                                />
                                            </SourcesContent>
                                        ))}
                                    </Sources>
                                )}
                                {message.parts.map((part, i) => {
                                    switch (part.type) {
                                        case 'text':
                                            return (
                                                <Fragment key={`${message.id}-${i}`}>
                                                    <Message from={message.role}>
                                                        <MessageContent>
                                                            <Response>
                                                                {part.text}
                                                            </Response>
                                                        </MessageContent>
                                                    </Message>
                                                    {message.role === 'assistant' && i === messages.length - 1 && (
                                                        <Actions className="mt-2">
                                                            <Action
                                                                onClick={retryLast}
                                                                label="Retry"
                                                            >
                                                                <RefreshCcwIcon className="size-3" />
                                                            </Action>
                                                            <Action
                                                                onClick={() =>
                                                                    navigator.clipboard.writeText(part.text)
                                                                }
                                                                label="Copy"
                                                            >
                                                                <CopyIcon className="size-3" />
                                                            </Action>
                                                        </Actions>
                                                    )}
                                                </Fragment>
                                            );
                                        case 'reasoning':
                                            return (
                                                <Reasoning
                                                    key={`${message.id}-${i}`}
                                                    className="w-full"
                                                    isStreaming={status === 'streaming' && i === message.parts.length - 1 && message.id === messages.at(-1)?.id}
                                                >
                                                    <ReasoningTrigger />
                                                    <ReasoningContent>{part.text}</ReasoningContent>
                                                </Reasoning>
                                            );
                                        default:
                                            return null;
                                    }
                                })}
                            </div>
                        ))}
                        {status === 'submitted' && <Loader />}
                    </ConversationContent>
                    <ConversationScrollButton />
                </Conversation>
            </div>
            <div className="sticky bottom-0 pb-4 bg-background">
                <PromptInput onSubmit={handleSubmit} globalDrop multiple>
                    <PromptInputBody>
                        <PromptInputAttachments>
                            {(attachment) => <PromptInputAttachment data={attachment} />}
                        </PromptInputAttachments>
                        <PromptInputTextarea
                            onChange={(e) => setInput(e.target.value)}
                            value={input}
                        />
                    </PromptInputBody>
                    <PromptInputToolbar>
                        <PromptInputTools>
                            <PromptInputActionMenu>
                                <PromptInputActionMenuTrigger />
                                <PromptInputActionMenuContent>
                                    <PromptInputActionAddAttachments />
                                </PromptInputActionMenuContent>
                            </PromptInputActionMenu>
                            {/* Web search disabled for now */}
                            {/* <PromptInputButton
                                variant={webSearch ? 'default' : 'ghost'}
                                onClick={() => setWebSearch(!webSearch)}
                            >
                                <GlobeIcon size={16} />
                                <span>Search</span>
                            </PromptInputButton> */}
                            <PromptInputModelSelect
                                onValueChange={(value) => {
                                    setModel(value);
                                }}
                                value={model}
                            >
                                <PromptInputModelSelectTrigger>
                                    <PromptInputModelSelectValue />
                                </PromptInputModelSelectTrigger>
                                <PromptInputModelSelectContent>
                                    {models.map((model) => (
                                        <PromptInputModelSelectItem key={model.value} value={model.value}>
                                            {model.name}
                                        </PromptInputModelSelectItem>
                                    ))}
                                </PromptInputModelSelectContent>
                            </PromptInputModelSelect>
                        </PromptInputTools>
                        <PromptInputSubmit disabled={!input && !status} status={status} />
                    </PromptInputToolbar>
                </PromptInput>
            </div>
        </div>
    );
};

export default ChatBotDemo;