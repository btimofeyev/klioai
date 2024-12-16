// Features Data
const features = [
    {
        icon: '🛡️',
        title: 'Kid-Safe Environment',
        description: 'Advanced content filtering and age-appropriate responses ensure your child explores safely and securely.',
        detail: 'Our AI is specifically trained to maintain child-friendly conversations and automatically filters any inappropriate content.',
        highlight: 'Real-time content monitoring'
    },
    {
        icon: '✨',
        title: 'Inspired Learning',
        description: 'From ancient myths to modern science, Klio sparks curiosity and makes every topic an exciting adventure.',
        detail: 'Interactive storytelling and engaging discussions that adapt to your child\'s interests and learning pace.',
        highlight: 'Personalized learning paths'
    },
    {
        icon: '👥',
        title: 'Parent Dashboard',
        description: 'Complete oversight with conversation summaries and activity monitoring. Always know what your child is learning.',
        detail: 'Track progress, review conversations, and set learning preferences through an intuitive parent control panel.',
        highlight: 'Full parental control'
    }
];

// Populate Features
document.getElementById('features').innerHTML = features.map((feature, index) => `
    <div class="features-section__card ${index % 2 === 0 ? 'features-section__card--left' : 'features-section__card--right'}">
        <div class="features-section__icon-wrapper">
            <span class="features-section__icon">${feature.icon}</span>
            <span class="features-section__number">${(index + 1).toString().padStart(2, '0')}</span>
        </div>
        <h3 class="features-section__title">${feature.title}</h3>
        <p class="features-section__description">${feature.description}</p>
        <div class="features-section__detail">
            <p>${feature.detail}</p>
            <span class="features-section__highlight">${feature.highlight}</span>
        </div>
    </div>
`).join('');

// Initialize Intersection Observer for feature cards
const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.3
};

const featureObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate');
            featureObserver.unobserve(entry.target); // Stop observing once animated
        }
    });
}, observerOptions);

// Start observing feature cards
document.querySelectorAll('.features-section__card').forEach(card => {
    featureObserver.observe(card);
});

// Stats Data
const stats = [
    { number: '1K+', label: 'Happy Learners' },
    { number: '10K+', label: 'Learning Conversations' },
    { number: '25+', label: 'Subject Areas' },
    { number: '99%', label: 'Parent Trust Rating' }
];

// Populate Stats
document.getElementById('stats').innerHTML = stats.map(stat => `
    <div class="stats-section__item">
        <div class="stats-section__number">${stat.number}</div>
        <div class="stats-section__label">${stat.label}</div>
    </div>
`).join('');

// Testimonials Data
const testimonials = [
    {
        quote: "Klio has sparked such curiosity in my daughter! She now comes to dinner full of fascinating facts about everything from dinosaurs to space.",
        author: "Emma R.",
        role: "Mother of 8-year-old"
    },
    {
        quote: "As a parent who's cautious about AI, I love that I can review all of Klio's conversations. The safety features are fantastic.",
        author: "Sarah M.",
        role: "Parent of two"
    },
    {
        quote: "My son struggled with reading comprehension, but his daily chats with Klio have made such a difference. He's actually excited to read and learn!",
        author: "Rachel M.",
        role: "Mom of a 10-year-old"
    }
];

// Populate Testimonials
document.getElementById('testimonials').innerHTML = testimonials.map(testimonial => `
    <div class="testimonials-section__card">
        <p class="testimonials-section__quote">${testimonial.quote}</p>
        <div class="testimonials-section__author">${testimonial.author}</div>
        <div class="testimonials-section__role">${testimonial.role}</div>
    </div>
`).join('');

// Footer Data
const footerBrand = {
    content: `
        <div class="chat__avatar"><img src="imgs/logo.png" alt="Klio AI Logo" style="width: 100%; height: 100%;"></div>
        <p>Fun, Safe, Smart – Just for Kids.</p>
    `
};

const footerLinks = {
    title: 'Company',
    links: [
        { text: 'Features', href: '/#features' },
        { text: 'Contact Us', href: 'mailto:support@klioai.com' },
        { text: 'Legal & Privacy', href: '/legal.html' }
    ]
};

// Populate Footer
document.getElementById('footer-brand').innerHTML = footerBrand.content;
document.getElementById('footer-links').innerHTML = `
    <h3 class="footer__title">${footerLinks.title}</h3>
    <ul class="footer__list">
        ${footerLinks.links.map(link => 
            `<li><a href="${link.href}">${link.text}</a></li>`
        ).join('')}
    </ul>
`;