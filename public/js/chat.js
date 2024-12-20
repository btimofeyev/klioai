const ChatState = {
    childData: null,
    conversationId: null,
    isProcessing: false,
    darkMode: localStorage.getItem('darkMode') === 'true',
    isInitialized: false
};

const API = {
    baseUrl: window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api',
    
    async request(endpoint, options = {}) {
        try {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) throw new Error('No authentication token found');

            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('API Error:', errorText);
                throw new Error(`Request failed: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API Request Error:', error);
            throw error;
        }
    },

    async stream(endpoint, data, onChunk) {
        try {
            const authToken = localStorage.getItem('authToken');
            if (!authToken) throw new Error('No authentication token found');

            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Accept': 'text/event-stream',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('API Error:', errorText);
                throw new Error(`Request failed: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            await onChunk(data);
                        } catch (e) {
                            console.error('Error parsing SSE data:', e);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('API Streaming Error:', error);
            throw error;
        }
    },

    get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    },

    post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
};

const UI = {
    elements: {},

    initialize() {
        const requiredElements = [
            'childName',
            'chatArea',
            'messageInput',
            'sendMessageBtn',
            'newConversationBtn',
            'themeToggleBtn',
            'logoutBtn',
        ];

        let missingElements = [];
        requiredElements.forEach(id => {
            const element = document.getElementById(id);
            element ? this.elements[id] = element : missingElements.push(id);
        });

        if (missingElements.length > 0) {
            console.error('Missing elements:', missingElements);
            return false;
        }

        this.initializeEventListeners();
        this.updateTheme();
        return true;
    },

    initializeEventListeners() {
        this.elements.sendMessageBtn.addEventListener('click', () => EventHandlers.handleSendMessage());
        this.elements.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                EventHandlers.handleSendMessage();
            }
        });
        this.elements.newConversationBtn.addEventListener('click', () => EventHandlers.handleNewConversation());
        this.elements.themeToggleBtn.addEventListener('click', () => EventHandlers.handleThemeToggle());
        this.elements.logoutBtn.addEventListener('click', () => EventHandlers.handleLogout());

        this.elements.chatArea.addEventListener('click', (e) => {
            if (e.target.classList.contains('suggestion-chip')) {
                const message = e.target.textContent.trim();
                EventHandlers.handleSendMessage(message);
            }
        });
    },

    createStreamingMessage() {
        const messageElement = document.createElement('div');
        messageElement.className = 'message ai-message streaming';
        messageElement.innerHTML = `
            <div class="message-content">
                <div class="section-content">
                    <p></p>
                </div>
            </div>
        `;
        
        this.elements.chatArea.appendChild(messageElement);
        return messageElement;
    },

    updateStreamingMessage(messageElement, content) {
        const contentElement = messageElement.querySelector('.section-content');
        if (!contentElement) {
            console.error('Content element not found in message');
            return;
        }

        try {
            contentElement.innerHTML = this.formatMessageForStreaming(content);
        } catch (error) {
            console.error('Error updating message content:', error);
            contentElement.textContent = content;
        }
    },

    finalizeStreamingMessage(messageElement, suggestions = null) {
        messageElement.classList.remove('streaming');
        
        if (suggestions && suggestions.length > 0) {
            const contentDiv = messageElement.querySelector('.message-content');
            if (contentDiv) {
                contentDiv.innerHTML += this.createSuggestionChips(suggestions);
            }
        }
    },

    formatMessageForStreaming(message) {
        // Clean up special characters
        let cleanedMessage = message
            .replace(/###/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    
        // Check if the message is a numbered list
        const isNumberedList = /^\d+\.\s+[A-Z]/.test(cleanedMessage);
    
        if (isNumberedList) {
            // Handle numbered lists
            const sections = cleanedMessage.split(/(?=\d+\.\s+[A-Z])/);
            
            return sections.map((section, index) => {
                if (index === 0 && !section.trim()) return '';
                
                const match = section.match(/(\d+\.\s+[^:]+):(.*)/s);
                if (match) {
                    const [_, title, content] = match;
                    return `
                        <div class="message-section">
                            <div class="section-title">${title.trim()}</div>
                            <div class="section-content">
                                <p>${content.trim()}</p>
                            </div>
                        </div>
                    `;
                }
                return `<p>${section.trim()}</p>`;
            }).join('');
        } else {
            // Handle sectioned paragraphs
            const sections = cleanedMessage.split(/\*\*(.*?)\*\*/g);
            let formattedContent = '';
            
            for (let i = 0; i < sections.length; i++) {
                if (i % 2 === 0) {
                    // Regular text
                    formattedContent += `<p>${sections[i]}</p>`;
                } else {
                    // Section titles
                    formattedContent += `<div class="section-title">${sections[i]}</div>`;
                }
            }
    
            return `
                <div class="message-section">
                    ${formattedContent}
                </div>
            `;
        }
    },

    appendMessage(sender, message, suggestions = null) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender}-message`;

        if (sender === 'ai') {
            let formattedMessage = message
                .replace(/^\s*\*\s+/gm, '')
                .replace(/###\s*/g, '')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .trim();

            messageElement.innerHTML = `
                <div class="message-content">
                    <p>${formattedMessage}</p>
                    ${suggestions ? this.createSuggestionChips(suggestions) : ''}
                </div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="message-content">
                    <p>${message}</p>
                </div>
            `;
        }

        this.elements.chatArea.appendChild(messageElement);
    },

    createSuggestionChips(suggestions) {
        return `
            <div class="suggestion-chips">
                ${suggestions.map(s => `<button class="suggestion-chip">${s}</button>`).join('')}
            </div>
        `;
    },

    updateTheme() {
        document.documentElement.setAttribute('data-theme', ChatState.darkMode ? 'dark' : 'light');
        this.elements.themeToggleBtn.innerHTML = ChatState.darkMode
            ? '<i class="fas fa-sun"></i>'
            : '<i class="fas fa-moon"></i>';
    },

    showError(message) {
        alert(message);
    },

    showSuccess(message) {
        const notification = document.createElement('div');
        notification.className = 'success-notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }
};

const EventHandlers = {
    async handleSendMessage(message = null) {
        if (ChatState.isProcessing) return;

        const messageText = message || UI.elements.messageInput.value.trim();
        if (!messageText) return;

        try {
            ChatState.isProcessing = true;

            UI.appendMessage('user', messageText);
            UI.elements.messageInput.value = '';

            if (!ChatState.conversationId) {
                const startResponse = await API.post('/chat/conversation/start');
                if (!startResponse.success) throw new Error('Failed to start conversation');
                ChatState.conversationId = startResponse.conversationId;
            }

            const streamingMessage = UI.createStreamingMessage();
            let fullResponse = '';

            await API.stream('/chat/message', {
                message: messageText,
                childId: ChatState.childData.id,
                conversationId: ChatState.conversationId
            }, async (data) => {
                if (data.error) {
                    throw new Error(data.message || 'Failed to process message');
                }

                if (data.done) {
                    UI.finalizeStreamingMessage(streamingMessage, data.suggestions);
                    
                    if (data.messageLimit && data.isNearLimit) {
                        UI.showSuccess(`${data.messagesRemaining} messages remaining today`);
                    }
                } else if (data.content) {
                    fullResponse += data.content;
                    UI.updateStreamingMessage(streamingMessage, fullResponse);
                }
            });

        } catch (error) {
            UI.showError(error.message || 'Failed to send message');
        } finally {
            ChatState.isProcessing = false;
        }
    },

    async handleNewConversation() {
        try {
            if (UI.elements.chatArea.children.length > 0) {
                if (!confirm('Start a new conversation? This will clear the current chat.')) return;
            }

            if (ChatState.conversationId) {
                await API.post(`/chat/conversation/${ChatState.conversationId}/end`);
            }

            const response = await API.post('/chat/conversation/start');

            if (response.success) {
                ChatState.conversationId = response.conversationId;
                UI.elements.chatArea.innerHTML = '';
                UI.appendMessage('ai',
                    `Hi ${ChatState.childData?.name || 'there'}! What would you like to talk about?`,
                    ['Tell me a story', 'Let\'s learn something', 'Play a game', 'Help with homework']
                );
                UI.showSuccess('Started new conversation!');
            } else {
                throw new Error('Failed to start new conversation');
            }
        } catch (error) {
            UI.showError('Unable to start new conversation');
        }
    },

    handleThemeToggle() {
        ChatState.darkMode = !ChatState.darkMode;
        localStorage.setItem('darkMode', ChatState.darkMode);
        UI.updateTheme();
    },

    async handleLogout() {
        try {
            if (ChatState.conversationId) {
                await API.post(`/chat/conversation/${ChatState.conversationId}/end`);
            }
        } catch {
            // Even if it fails, we still logout
        } finally {
            localStorage.clear();
            window.location.href = '/index.html';
        }
    }
};

async function initializeChat() {
    try {
        const authToken = localStorage.getItem('authToken');
        const userData = JSON.parse(localStorage.getItem('userData') || 'null');

        if (!authToken || !userData) {
            window.location.href = '/index.html';
            return;
        }

        if (!UI.initialize()) {
            throw new Error('Failed to initialize UI');
        }

        ChatState.childData = userData;
        UI.elements.childName.textContent = userData.name || 'Friend';

        const profileResponse = await API.get('/children/profile');
        if (profileResponse.success) {
            ChatState.childData = { ...ChatState.childData, ...profileResponse };
        }

        const activeResponse = await API.get('/chat/conversation/active');
        if (!activeResponse.success || !activeResponse.conversation) {
            await EventHandlers.handleNewConversation();
        } else {
            ChatState.conversationId = activeResponse.conversation.id;
        }

        ChatState.isInitialized = true;
    } catch (error) {
        UI.showError('Failed to initialize chat');
    }
}

document.addEventListener('DOMContentLoaded', initializeChat);