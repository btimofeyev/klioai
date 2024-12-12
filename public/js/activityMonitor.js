// chatMonitor.js
class ChatMonitor {
    constructor() {
        this.initializeElements();
        this.attachEventListeners();
        this.initializeTabs();

    }

    initializeElements() {
        this.elements = {
            childSelect: document.getElementById('chatChildFilter'),
            summariesList: document.querySelector('.summaries-list'),
            summaryCount: document.getElementById('summaryCount'),
            topicFilter: document.getElementById('topicFilter'),
            interestsList: document.getElementById('interestsList')
        };
        
        this.loadChildren();
    }
    

    async loadChildren() {
        try {
            const response = await fetch('/api/children', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });

            const data = await response.json();

            if (data.success && data.children) {
                this.elements.childSelect.innerHTML = `
                    <option value="">Select a child</option>
                    ${data.children.map(child => `
                        <option value="${child.id}">${child.name}</option>
                    `).join('')}
                `;
            }
        } catch (error) {
            console.error('Error loading children:', error);
        }
    }
    initializeTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const summariesContainer = document.querySelector('.summaries-container');
        const memoryContainer = document.querySelector('.memory-container');
    
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Update active tab button
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
    
                // Show/hide appropriate container
                if (button.dataset.tab === 'summaries') {
                    summariesContainer.classList.add('active');
                    memoryContainer.classList.remove('active');
                } else {
                    memoryContainer.classList.add('active');
                    summariesContainer.classList.remove('active');
                }
            });
        });
    
        // Set initial state
        summariesContainer.classList.add('active');
    }
    attachEventListeners() {
        this.elements.childSelect.addEventListener('change', (e) => {
            const childId = e.target.value;
            if (childId) {
                this.loadChildData(childId); // New method to load all child data
            } else {
                this.clearContent();
            }
        });
    
        // Add view toggle listeners
        this.elements.viewToggles?.forEach(toggle => {
            toggle.addEventListener('click', () => {
                // Update active state
                this.elements.viewToggles.forEach(t => t.classList.remove('active'));
                toggle.classList.add('active');
                this.switchMemoryView(toggle.dataset.view);
            });
        });
    }

    async loadChildSummaries(childId) {
        try {
            const response = await fetch(`/api/children/${childId}/summaries`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });

            const data = await response.json();

            if (data.success) {
                this.renderSummaries(data.summaries);
            }
        } catch (error) {
            console.error('Error loading summaries:', error);
            this.elements.summariesList.innerHTML = '<p>Error loading summaries</p>';
        }
    }
    renderSummaries(summaries) {
        if (this.elements.summaryCount) {
            this.elements.summaryCount.textContent = `${summaries.length} conversations analyzed`;
        }
    
        // Render topic pills for filtering at the top
        const topics = new Set();
        summaries.forEach(summary => {
            const extractedTopics = this.extractTopics(summary.summary);
            extractedTopics.forEach(topic => topics.add(topic));
        });
    
        // Group summaries by date
        const groupedSummaries = this.groupSummariesByDate(summaries);
    
        // Create the card slider container
        this.elements.summariesList.innerHTML = `
            <div class="topic-pills">
                <button class="topic-pill active" data-topic="all">
                    <i class="fas fa-tags"></i> All Topics
                </button>
                ${[...topics].map(topic => `
                    <button class="topic-pill" data-topic="${topic}">
                        <i class="fas fa-tag"></i> ${topic}
                    </button>
                `).join('')}
            </div>
            
            <div class="summaries-slider">
                ${summaries.map((summary, index) => `
                    <div class="summary-card" data-topics='${JSON.stringify(this.extractTopics(summary.summary))}'>
                        <div class="summary-meta">
                            <div class="summary-datetime">
                                <span class="summary-date">${this.formatDate(summary.created_at)}</span>
                                <span class="summary-time">
                                    <i class="far fa-clock"></i>
                                    ${this.formatTime(summary.created_at)}
                                </span>
                            </div>
                            ${this.renderEngagementLevel(summary.summary)}
                        </div>
    
                        <div class="summary-topics-container">
                            <h4>Topics Discussed</h4>
                            <div class="summary-topics">
                                ${this.extractTopics(summary.summary)
                                    .map(topic => `
                                        <span class="topic-tag">
                                            <i class="fas fa-tag"></i>
                                            ${topic}
                                        </span>
                                    `).join('')}
                            </div>
                        </div>
    
                        <div class="summary-content">
                            <div class="summary-overview">
                                <h4><i class="fas fa-comment-dots"></i> Conversation Overview</h4>
                                ${this.formatSummaryContent(summary.summary)}
                            </div>
                        </div>
                        
                        <div class="summary-navigation">
                            <span class="summary-counter">${index + 1} of ${summaries.length}</span>
                            <div class="navigation-buttons">
                                <button class="nav-btn prev-btn" ${index === 0 ? 'disabled' : ''}>
                                    <i class="fas fa-chevron-left"></i>
                                </button>
                                <button class="nav-btn next-btn" ${index === summaries.length - 1 ? 'disabled' : ''}>
                                    <i class="fas fa-chevron-right"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    
        this.initializeSlider();
        this.initializeTopicFilters();
    }
    initializeSlider() {
        const slider = document.querySelector('.summaries-slider');
        if (!slider) return;
    
        const cards = slider.querySelectorAll('.summary-card');
        let currentIndex = 0;
    
        const updateCardVisibility = () => {
            cards.forEach((card, index) => {
                card.style.display = index === currentIndex ? 'block' : 'none';
            });
        };
    
        slider.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (btn.classList.contains('prev-btn') && currentIndex > 0) {
                    currentIndex--;
                } else if (btn.classList.contains('next-btn') && currentIndex < cards.length - 1) {
                    currentIndex++;
                }
                updateCardVisibility();
                this.updateNavigationButtons(currentIndex, cards.length);
            });
        });
    
        // Initialize first card
        updateCardVisibility();
    }
    updateNavigationButtons(currentIndex, totalCards) {
        const prevBtn = document.querySelector('.prev-btn');
        const nextBtn = document.querySelector('.next-btn');
        
        if (prevBtn) prevBtn.disabled = currentIndex === 0;
        if (nextBtn) nextBtn.disabled = currentIndex === totalCards - 1;
    }
    initializeTopicFilters() {
        const topicPills = document.querySelectorAll('.topic-pill');
        topicPills.forEach(pill => {
            pill.addEventListener('click', () => {
                // Update active state
                topicPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                // Filter summaries
                const selectedTopic = pill.dataset.topic;
                this.filterSummariesByTopic(selectedTopic);
            });
        });
    }

    filterSummariesByTopic(topic) {
        const summaryCards = document.querySelectorAll('.summary-card');
        
        if (topic === 'all') {
            summaryCards.forEach(card => card.style.display = 'block');
            document.querySelectorAll('.topic-pill').forEach(pill => {
                pill.classList.remove('active');
            });
            document.querySelector('.topic-pill[data-topic="all"]').classList.add('active');
            return;
        }

        summaryCards.forEach(card => {
            const cardTopics = Array.from(card.querySelectorAll('.topic-tag'))
                .map(tag => tag.textContent.trim().toLowerCase());
            
            if (cardTopics.includes(topic.toLowerCase())) {
                card.style.display = 'block';
            } else {
                card.style.display = 'none';
            }
        });

        // Update active state of topic pills
        document.querySelectorAll('.topic-pill').forEach(pill => {
            pill.classList.remove('active');
            if (pill.getAttribute('data-topic').toLowerCase() === topic.toLowerCase()) {
                pill.classList.add('active');
            }
        });
    }

    groupSummariesByDate(summaries) {
        const groups = {};
        summaries.forEach(summary => {
            const date = new Date(summary.created_at);
            const dateKey = this.formatDateGroup(date);
            if (!groups[dateKey]) {
                groups[dateKey] = [];
            }
            groups[dateKey].push(summary);
        });
        return groups;
    }

    formatDateGroup(date) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return 'Today';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
            });
        }
    }

    formatTime(dateString) {
        try {
            const date = new Date(dateString);
            if (!dateString || isNaN(date.getTime())) {
                return '';
            }
            
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        } catch (error) {
            return '';
        }
    }

    formatSummaryContent(content) {
        const sections = content.split('\n\n');
        let formattedContent = '';

        sections.forEach(section => {
            if (section.trim().startsWith('🚨 Topics of Concern')) {
                const concerningTopics = section.split('\n').slice(1).join('\n');
                if (concerningTopics.includes('No concerning topics discussed')) {
                    formattedContent += `
                        <div class="summary-section safe-topics">
                            <h4><i class="fas fa-shield-alt"></i> Topics of Concern</h4>
                            <p class="no-concerns">✅ No concerning topics discussed</p>
                        </div>`;
                } else {
                    formattedContent += `
                        <div class="summary-section concerning-topics">
                            <h4><i class="fas fa-exclamation-triangle"></i> Topics of Concern</h4>
                            <div class="warning-content">
                                ${concerningTopics.split('\n').map(topic => 
                                    `<p class="concern-item">${topic.trim().replace(/^-\s*/, '')}</p>`
                                ).join('')}
                            </div>
                        </div>`;
                }
            }
            else if (section.trim().startsWith('💭 Topics Discussed')) {
                const topics = section.split('\n').slice(1);
                formattedContent += `
                    <div class="summary-section topics-discussed">
                        <h4><i class="fas fa-comments"></i> Topics Discussed</h4>
                        <div class="topics-grid">
                            ${topics.map(topic => 
                                `<span class="topic-bubble">${topic.trim().replace(/^-\s*/, '')}</span>`
                            ).join('')}
                        </div>
                    </div>`;
            }
            else if (section.trim().startsWith('📊 Engagement Level')) {
                const engagementInfo = section.split('\n').slice(1);
                const level = engagementInfo[0].replace(/^-\s*/, '').split(':')[0];
                const explanation = engagementInfo[1]?.replace(/^-\s*/, '') || '';
                formattedContent += `
                    <div class="summary-section engagement-level">
                        <h4><i class="fas fa-chart-line"></i> Engagement Level</h4>
                        <div class="engagement-indicator ${level.toLowerCase()}">
                            <span class="level">${level}</span>
                            <p class="explanation">${explanation}</p>
                        </div>
                    </div>`;
            }
            else if (section.trim().startsWith('📚 Key Learning Points')) {
                const points = section.split('\n').slice(1);
                formattedContent += `
                    <div class="summary-section learning-points">
                        <h4><i class="fas fa-graduation-cap"></i> Key Learning Points</h4>
                        <ul>
                            ${points.map(point => 
                                `<li>${point.trim().replace(/^-\s*/, '')}</li>`
                            ).join('')}
                        </ul>
                    </div>`;
            }
            else if (section.trim().startsWith('👪 Parent Tips')) {
                const tips = section.split('\n').slice(1);
                formattedContent += `
                    <div class="summary-section parent-tips">
                        <h4><i class="fas fa-lightbulb"></i> Parent Tips</h4>
                        <ul>
                            ${tips.map(tip => 
                                `<li>${tip.trim().replace(/^-\s*/, '')}</li>`
                            ).join('')}
                        </ul>
                    </div>`;
            }
        });

        return formattedContent;
    }

    renderEngagementLevel(content) {
        const engagementMatch = content.match(/Engagement Level:(.*?)(?=\n\n)/s);
        if (!engagementMatch) return '';

        const engagementText = engagementMatch[1].trim();
        const level = engagementText.split('\n')[0].toLowerCase().includes('high') ? 'high' 
                   : engagementText.toLowerCase().includes('medium') ? 'medium' 
                   : 'low';

        const pillClasses = {
            high: 'success',
            medium: 'neutral',
            low: 'warning'
        };

        return `
            <div class="engagement-section">
                <span class="status-pill ${pillClasses[level]}">
                    ${level.charAt(0).toUpperCase() + level.slice(1)} Engagement
                </span>
            </div>
        `;
    }

    renderTopicPills(topics) {
        const uniqueTopics = [...new Set(topics)];
        return `
            <div class="topic-pills">
                <button class="topic-pill active" data-topic="all" onclick="chatMonitor.filterSummariesByTopic('all')">
                    <i class="fas fa-tags"></i> All Topics
                </button>
                ${uniqueTopics.map(topic => `
                    <button class="topic-pill" data-topic="${topic}" onclick="chatMonitor.filterSummariesByTopic('${topic}')">
                        <i class="fas fa-tag"></i> ${topic}
                    </button>
                `).join('')}
            </div>
        `;
    }

    renderEmotionalInsights(content) {
        const emotionMatch = content.match(/Emotional State:(.*?)(?=\n\n)/s);
        if (!emotionMatch) return '';

        const emotions = emotionMatch[1].trim();
        const emotionIcon = this.getEmotionIcon(emotions);

        return `
            <div class="emotional-insights">
                <h4><i class="fas fa-heart"></i> Emotional Insights</h4>
                <div class="emotion-indicator">
                    ${emotionIcon}
                    <p>${emotions}</p>
                </div>
            </div>
        `;
    }

    getEmotionIcon(emotions) {
        if (emotions.toLowerCase().includes('happy') || emotions.toLowerCase().includes('excited')) {
            return '<i class="fas fa-smile-beam"></i>';
        } else if (emotions.toLowerCase().includes('curious') || emotions.toLowerCase().includes('interested')) {
            return '<i class="fas fa-lightbulb"></i>';
        } else if (emotions.toLowerCase().includes('calm') || emotions.toLowerCase().includes('focused')) {
            return '<i class="fas fa-peace"></i>';
        } else {
            return '<i class="fas fa-smile"></i>';
        }
    }

    renderRecommendations(content) {
        const recommendationsMatch = content.match(/Recommendations:(.*?)(?=\n\n|$)/s);
        if (!recommendationsMatch) return '';

        const recommendations = recommendationsMatch[1]
            .split('\n')
            .map(line => line.replace(/[-*]/g, '').trim())
            .filter(line => line.length > 0);

        return `
            <div class="recommendations">
                <h4><i class="fas fa-lightbulb"></i> Parent Tips</h4>
                <ul>
                    ${recommendations.map(rec => `
                        <li>
                            <i class="fas fa-star"></i>
                            ${rec}
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }
    initializeInteractiveElements() {
        // Add hover effects and tooltips
        const topicTags = document.querySelectorAll('.topic-tag');
        topicTags.forEach(tag => {
            tag.title = 'Click to filter by this topic';
            tag.addEventListener('click', () => this.filterByTopic(tag.textContent.trim()));
        });

        // Initialize any other interactive elements
    }

    filterByTopic(topic) {
        const summaryCards = document.querySelectorAll('.summary-card');
        summaryCards.forEach(card => {
            const hasTag = Array.from(card.querySelectorAll('.topic-tag'))
                .some(tag => tag.textContent.trim() === topic);
            card.style.display = hasTag ? 'block' : 'none';
        });
    }

    cleanupSummary(content) {
        // Remove the date line and any empty lines at the start
        return content
            .replace(/\*\*Date:\*\*.*?\n/g, '')
            .replace(/^\s*\n/gm, '')
            .trim();
    }
    renderEngagementLevel(content) {
        const engagementMatch = content.match(/Engagement Level:(.*?)(?=\n\n)/s);
        if (!engagementMatch) return '';

        const engagementText = engagementMatch[1].trim();
        const level = engagementText.split('\n')[0].toLowerCase().includes('high') ? 'high' 
                   : engagementText.toLowerCase().includes('medium') ? 'medium' 
                   : 'low';

        const pillClasses = {
            high: 'success',
            medium: 'neutral',
            low: 'warning'
        };

        return `
            <div class="engagement-section">
                <span class="status-pill ${pillClasses[level]}">
                    ${level.charAt(0).toUpperCase() + level.slice(1)} Engagement
                </span>
            </div>
        `;
    }

    formatSummaryContent(content) {
        const sections = content.split('\n\n');
        let formattedContent = '';

        sections.forEach(section => {
            if (section.trim().startsWith('🚨 Topics of Concern')) {
                const concerningTopics = section.split('\n').slice(1).join('\n');
                if (concerningTopics.includes('No concerning topics discussed')) {
                    formattedContent += `
                        <div class="summary-section safe-topics">
                            <h4><i class="fas fa-shield-alt"></i> Topics of Concern</h4>
                            <p class="no-concerns">✅ No concerning topics discussed</p>
                        </div>`;
                } else {
                    formattedContent += `
                        <div class="summary-section concerning-topics">
                            <h4><i class="fas fa-exclamation-triangle"></i> Topics of Concern</h4>
                            <div class="warning-content">
                                ${concerningTopics.split('\n').map(topic => 
                                    `<p class="concern-item">${topic.trim().replace(/^-\s*/, '')}</p>`
                                ).join('')}
                            </div>
                        </div>`;
                }
            }
            else if (section.trim().startsWith('💭 Topics Discussed')) {
                const topics = section.split('\n').slice(1);
                formattedContent += `
                    <div class="summary-section topics-discussed">
                        <h4><i class="fas fa-comments"></i> Topics Discussed</h4>
                        <div class="topics-grid">
                            ${topics.map(topic => 
                                `<span class="topic-bubble">${topic.trim().replace(/^-\s*/, '')}</span>`
                            ).join('')}
                        </div>
                    </div>`;
            }
            else if (section.trim().startsWith('📊 Engagement Level')) {
                const engagementInfo = section.split('\n').slice(1);
                const level = engagementInfo[0].replace(/^-\s*/, '').split(':')[0];
                const explanation = engagementInfo[1]?.replace(/^-\s*/, '') || '';
                formattedContent += `
                    <div class="summary-section engagement-level">
                        <h4><i class="fas fa-chart-line"></i> Engagement Level</h4>
                        <div class="engagement-indicator ${level.toLowerCase()}">
                            <span class="level">${level}</span>
                            <p class="explanation">${explanation}</p>
                        </div>
                    </div>`;
            }
            else if (section.trim().startsWith('📚 Key Learning Points')) {
                const points = section.split('\n').slice(1);
                formattedContent += `
                    <div class="summary-section learning-points">
                        <h4><i class="fas fa-graduation-cap"></i> Key Learning Points</h4>
                        <ul>
                            ${points.map(point => 
                                `<li>${point.trim().replace(/^-\s*/, '')}</li>`
                            ).join('')}
                        </ul>
                    </div>`;
            }
            else if (section.trim().startsWith('👪 Parent Tips')) {
                const tips = section.split('\n').slice(1);
                formattedContent += `
                    <div class="summary-section parent-tips">
                        <h4><i class="fas fa-lightbulb"></i> Parent Tips</h4>
                        <ul>
                            ${tips.map(tip => 
                                `<li>${tip.trim().replace(/^-\s*/, '')}</li>`
                            ).join('')}
                        </ul>
                    </div>`;
            }
        });

        return formattedContent;
    }

    extractTopics(content) {
        const topicsMatch = content.match(/Topics Discussed:(.*?)(?=\n\n|$)/s);
        if (!topicsMatch) return [];

        return topicsMatch[1]
            .split('\n')
            .map(line => line.replace(/[-*]/g, '').trim())
            .filter(line => line.length > 0);
    }

    formatDate(dateString) {
        try {
            // Handle ISO string or timestamp
            const date = dateString instanceof Date ? dateString : new Date(dateString);
            
            // Additional validation
            if (!dateString || isNaN(date.getTime())) {
                return 'Date not available';
            }
    
            // Get current date for comparison
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
    
            // Format based on relative time
            if (date.toDateString() === today.toDateString()) {
                return 'Today';
            } else if (date.toDateString() === yesterday.toDateString()) {
                return 'Yesterday';
            }
    
            return date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
            });
        } catch (error) {
            console.error('Date parsing error:', error, 'for date:', dateString);
            return 'Date not available';
        }
    }
    
    async loadChildData(childId) {
        this.currentChildId = childId;
        try {
            await Promise.all([
                this.loadChildSummaries(childId),
                this.loadChildMemory(childId)
            ]);
        } catch (error) {
            console.error('Error loading child data:', error);
        }
    }
    
    async loadChildMemory(childId) {
        try {
            const response = await fetch(`/api/children/${childId}/memory`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                }
            });
    
            const data = await response.json();
    
            if (data.success) {
                this.renderMemory(data.memory);
            }
        } catch (error) {
            console.error('Error loading memory:', error);
            if (this.elements.interestsList) {
                this.elements.interestsList.innerHTML = '<p>Error loading memory data</p>';
            }
        }
    }
    renderMemory(memory) {
        if (!this.elements.interestsList) return;
    
        const interests = Object.entries(memory.knowledgeGraph || {})
            .map(([topic, data]) => ({
                topic,
                details: data.details
            }));
    
        this.elements.interestsList.innerHTML = interests.map(interest => `
            <div class="interest-card">
                <div class="interest-header">
                    <h3 class="interest-title">
                        <i class="fas fa-star"></i>
                        ${interest.topic}
                    </h3>
                    <button class="delete-memory-btn" data-topic="${interest.topic}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                
                <div class="knowledge-bits">
                    ${interest.details.knowledge_bits.map(bit => `
                        <div class="knowledge-bit">
                            <i class="fas fa-lightbulb"></i>
                            <span>${bit.fact}</span>
                        </div>
                    `).join('')}
                </div>
    
                ${interest.details.sub_topics.length > 0 ? `
                    <div class="related-topics">
                        ${interest.details.sub_topics.map(topic => `
                            <span class="related-topic">${topic}</span>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('');

        // Add event listeners to delete buttons
        this.elements.interestsList.querySelectorAll('.delete-memory-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleMemoryDelete(e));
        });
    }
    async handleMemoryDelete(event) {
        const button = event.currentTarget;
        const topic = button.dataset.topic;
        
        if (!this.currentChildId) return;

        if (confirm(`Are you sure you want to delete the memory about "${topic}"? This will affect the chatbot's memory of this topic.`)) {
            try {
                const response = await fetch(`/api/children/${this.currentChildId}/memory/${encodeURIComponent(topic)}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    // Remove the memory card from the UI
                    const card = button.closest('.interest-card');
                    card.remove();
                    
                    // Show success message
                    this.showNotification('Memory deleted successfully', 'success');
                } else {
                    throw new Error('Failed to delete memory');
                }
            } catch (error) {
                console.error('Error deleting memory:', error);
                this.showNotification('Failed to delete memory', 'error');
            }
        }
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
    getEngagementLabel(engagement) {
        if (engagement >= 8) return '<span class="badge high">High Interest</span>';
        if (engagement >= 5) return '<span class="badge medium">Growing Interest</span>';
        return '<span class="badge low">New Interest</span>';
    }
    
    switchMemoryView(view) {
        if (this.elements.memoryContent) {
            this.elements.memoryContent.className = `memory-content ${view}-view`;
        }
    }
    
    clearContent() {
        this.elements.summariesList.innerHTML = '';
        this.elements.topicFilter.innerHTML = '';
        if (this.elements.interestsList) {
            this.elements.interestsList.innerHTML = '';
        }
        if (this.elements.knowledgeGraph) {
            this.elements.knowledgeGraph.innerHTML = '';
        }
    }
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('chats')) {
        window.chatMonitor = new ChatMonitor();
    }
});