// activityMonitor.js
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
                headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
            });
            const data = await response.json();
            if (data.success && data.children) {
                this.elements.childSelect.innerHTML = `
                    <option value="">Select a child</option>
                    ${data.children.map(child => `<option value="${child.id}">${child.name}</option>`).join('')}
                `;
            }
        } catch {
            // In production, consider user notification
        }
    }

    initializeTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const summariesContainer = document.querySelector('.summaries-container');
        const memoryContainer = document.querySelector('.memory-container');
    
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
    
                if (button.dataset.tab === 'summaries') {
                    summariesContainer.classList.add('active');
                    memoryContainer.classList.remove('active');
                } else {
                    memoryContainer.classList.add('active');
                    summariesContainer.classList.remove('active');
                }
            });
        });
    
        summariesContainer.classList.add('active');
    }

    attachEventListeners() {
        this.elements.childSelect.addEventListener('change', (e) => {
            const childId = e.target.value;
            if (childId) {
                this.loadChildData(childId);
            } else {
                this.clearContent();
            }
        });
    }

    async loadChildData(childId) {
        this.currentChildId = childId;
        try {
            await Promise.all([
                this.loadChildSummaries(childId),
                this.loadChildMemory(childId)
            ]);
        } catch {
            // In production, consider user notification
        }
    }

    async loadChildSummaries(childId) {
        try {
            const response = await fetch(`/api/children/${childId}/summaries`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
            });
            const data = await response.json();
            if (data.success) this.renderSummaries(data.summaries);
        } catch {
            if (this.elements.summariesList) {
                this.elements.summariesList.innerHTML = '<p>Error loading summaries</p>';
            }
        }
    }

    renderSummaries(summaries) {
        if (this.elements.summaryCount) {
            this.elements.summaryCount.textContent = `${summaries.length} conversations analyzed`;
        }

        const topics = new Set();
        summaries.forEach(summary => {
            this.extractTopics(summary.summary).forEach(t => topics.add(t));
        });

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
                ${summaries.map((summary, index) => this.renderSummaryCard(summary, index, summaries.length)).join('')}
            </div>
        `;

        this.initializeSlider();
        this.initializeTopicFilters();
    }

    renderSummaryCard(summary, index, total) {
        const topics = this.extractTopics(summary.summary);
        return `
            <div class="summary-card" data-topics='${JSON.stringify(topics)}'>
                <div class="summary-meta">
                    <div class="summary-datetime">
                        <span class="summary-date">${this.formatDate(summary.created_at)}</span>
                        <span class="summary-time"><i class="far fa-clock"></i>${this.formatTime(summary.created_at)}</span>
                    </div>
                    ${this.renderEngagementLevel(summary.summary)}
                </div>

                <div class="summary-topics-container">
                    <h4>Topics Discussed</h4>
                    <div class="summary-topics">
                        ${topics.map(t => `<span class="topic-tag"><i class="fas fa-tag"></i>${t}</span>`).join('')}
                    </div>
                </div>

                <div class="summary-content">
                    <div class="summary-overview">
                        <h4><i class="fas fa-comment-dots"></i> Conversation Overview</h4>
                        ${this.formatSummaryContent(summary.summary)}
                    </div>
                </div>
                
                <div class="summary-navigation">
                    <span class="summary-counter">${index + 1} of ${total}</span>
                    <div class="navigation-buttons">
                        <button class="nav-btn prev-btn" ${index === 0 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
                        <button class="nav-btn next-btn" ${index === total - 1 ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
                    </div>
                </div>
            </div>
        `;
    }

    initializeSlider() {
        const slider = document.querySelector('.summaries-slider');
        if (!slider) return;
    
        const cards = slider.querySelectorAll('.summary-card');
        let currentIndex = 0;
    
        const updateCardVisibility = () => {
            cards.forEach((card, i) => {
                card.style.display = i === currentIndex ? 'block' : 'none';
            });
        };

        slider.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('prev-btn') && currentIndex > 0) currentIndex--;
                else if (btn.classList.contains('next-btn') && currentIndex < cards.length - 1) currentIndex++;
                updateCardVisibility();
                this.updateNavigationButtons(currentIndex, cards.length);
            });
        });
    
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
                topicPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.filterSummariesByTopic(pill.dataset.topic);
            });
        });
    }

    filterSummariesByTopic(topic) {
        const summaryCards = document.querySelectorAll('.summary-card');
        
        if (topic === 'all') {
            summaryCards.forEach(card => card.style.display = 'block');
            return;
        }

        summaryCards.forEach(card => {
            const cardTopics = Array.from(card.querySelectorAll('.topic-tag'))
                .map(tag => tag.textContent.trim().toLowerCase());
            card.style.display = cardTopics.includes(topic.toLowerCase()) ? 'block' : 'none';
        });
    }

    async loadChildMemory(childId) {
        try {
            const response = await fetch(`/api/children/${childId}/memory`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
            });
            const data = await response.json();
            if (data.success) this.renderMemory(data.memory);
        } catch {
            if (this.elements.interestsList) {
                this.elements.interestsList.innerHTML = '<p>Error loading memory data</p>';
            }
        }
    }

    renderMemory(memory) {
        if (!this.elements.interestsList) return;
    
        const interests = Object.entries(memory.knowledgeGraph || {})
            .map(([topic, details]) => ({ topic, ...details }));

        this.elements.interestsList.innerHTML = interests.map(interest => this.renderInterestCard(interest)).join('');

        this.elements.interestsList.querySelectorAll('.delete-memory-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleMemoryDelete(e));
        });
    }

    renderInterestCard(interest) {
        const { topic, details } = interest;
        return `
            <div class="interest-card">
                <div class="interest-header">
                    <h3 class="interest-title"><i class="fas fa-star"></i>${topic}</h3>
                    <button class="delete-memory-btn" data-topic="${topic}"><i class="fas fa-trash"></i></button>
                </div>
                <div class="knowledge-bits">
                    ${details.knowledge_bits.map(bit => `
                        <div class="knowledge-bit">
                            <i class="fas fa-lightbulb"></i><span>${bit.fact}</span>
                        </div>`).join('')}
                </div>
                ${details.sub_topics.length ? `
                    <div class="related-topics">
                        ${details.sub_topics.map(t => `<span class="related-topic">${t}</span>`).join('')}
                    </div>` : ''}
            </div>
        `;
    }

    async handleMemoryDelete(event) {
        const button = event.currentTarget;
        const topic = button.dataset.topic;
        
        if (!this.currentChildId) return;

        if (confirm(`Delete memory about "${topic}"?`)) {
            try {
                const response = await fetch(
                    `/api/children/${this.currentChildId}/memory/${encodeURIComponent(topic)}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (response.ok) {
                    button.closest('.interest-card').remove();
                    this.showNotification('Memory deleted successfully', 'success');
                } else {
                    throw new Error();
                }
            } catch {
                this.showNotification('Failed to delete memory', 'error');
            }
        }
    }

    showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }

    formatTime(dateString) {
        const date = new Date(dateString);
        return (dateString && !isNaN(date.getTime()))
            ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
            : '';
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        if (!dateString || isNaN(date.getTime())) return 'Date not available';
        
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    }

    extractTopics(content) {
        const topicsMatch = content.match(/Topics Discussed:(.*?)(?=\n\n|$)/s);
        if (!topicsMatch) return [];
        return topicsMatch[1]
            .split('\n')
            .map(line => line.replace(/[-*]/g, '').trim())
            .filter(line => line.length > 0);
    }

    renderEngagementLevel(content) {
        const engagementMatch = content.match(/Engagement Level:(.*?)(?=\n\n)/s);
        if (!engagementMatch) return '';

        const engagementText = engagementMatch[1].trim().toLowerCase();
        const level = engagementText.includes('high') ? 'high'
                   : engagementText.includes('medium') ? 'medium'
                   : 'low';

        const pillClasses = { high: 'success', medium: 'neutral', low: 'warning' };
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
        return sections.map(section => this.formatSection(section.trim())).join('');
    }

    formatSection(section) {
        if (section.startsWith('🚨 Topics of Concern')) {
            return this.renderConcernSection(section);
        } else if (section.startsWith('💭 Topics Discussed')) {
            return this.renderDiscussedTopicsSection(section);
        } else if (section.startsWith('📊 Engagement Level')) {
            return this.renderEngagementSection(section);
        } else if (section.startsWith('📚 Key Learning Points')) {
            return this.renderLearningPointsSection(section);
        } else if (section.startsWith('👪 Parent Tips')) {
            return this.renderParentTipsSection(section);
        }
        return '';
    }

    renderConcernSection(section) {
        const topics = section.split('\n').slice(1).join('\n');
        return topics.includes('No concerning topics discussed')
            ? `
                <div class="summary-section safe-topics">
                    <h4><i class="fas fa-shield-alt"></i> Topics of Concern</h4>
                    <p class="no-concerns">✅ No concerning topics discussed</p>
                </div>`
            : `
                <div class="summary-section concerning-topics">
                    <h4><i class="fas fa-exclamation-triangle"></i> Topics of Concern</h4>
                    <div class="warning-content">
                        ${topics.split('\n').map(t => `<p class="concern-item">${t.trim().replace(/^-\s*/, '')}</p>`).join('')}
                    </div>
                </div>`;
    }

    renderDiscussedTopicsSection(section) {
        const topics = section.split('\n').slice(1);
        return `
            <div class="summary-section topics-discussed">
                <h4><i class="fas fa-comments"></i> Topics Discussed</h4>
                <div class="topics-grid">
                    ${topics.map(t => `<span class="topic-bubble">${t.trim().replace(/^-\s*/, '')}</span>`).join('')}
                </div>
            </div>`;
    }

    renderEngagementSection(section) {
        const info = section.split('\n').slice(1);
        const level = info[0].replace(/^-\s*/, '').split(':')[0];
        const explanation = info[1]?.replace(/^-\s*/, '') || '';
        return `
            <div class="summary-section engagement-level">
                <h4><i class="fas fa-chart-line"></i> Engagement Level</h4>
                <div class="engagement-indicator ${level.toLowerCase()}">
                    <span class="level">${level}</span>
                    <p class="explanation">${explanation}</p>
                </div>
            </div>`;
    }

    renderLearningPointsSection(section) {
        const points = section.split('\n').slice(1);
        return `
            <div class="summary-section learning-points">
                <h4><i class="fas fa-graduation-cap"></i> Key Learning Points</h4>
                <ul>${points.map(p => `<li>${p.trim().replace(/^-\s*/, '')}</li>`).join('')}</ul>
            </div>`;
    }

    renderParentTipsSection(section) {
        const tips = section.split('\n').slice(1);
        return `
            <div class="summary-section parent-tips">
                <h4><i class="fas fa-lightbulb"></i> Parent Tips</h4>
                <ul>${tips.map(t => `<li>${t.trim().replace(/^-\s*/, '')}</li>`).join('')}</ul>
            </div>`;
    }

    clearContent() {
        if (this.elements.summariesList) this.elements.summariesList.innerHTML = '';
        if (this.elements.topicFilter) this.elements.topicFilter.innerHTML = '';
        if (this.elements.interestsList) this.elements.interestsList.innerHTML = '';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('chats')) {
        window.chatMonitor = new ChatMonitor();
    }
});
