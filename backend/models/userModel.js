const pool = require('../config/db');

const PLANS = {
  single: {
    priceId: 'price_1QP9N4DII9A9349ohlOJgJEE',
    name: 'Single Account Plan'
  },
  familypro: {
    priceId: 'price_1QP9NLDII9A9349oDRxFpdWx',
    name: 'Family Pro Account Plan'
  }
};

class User {
  static async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const { rows } = await pool.query(query, [email]);
    return rows[0];
  }

  static async create(userData) {
    const {
      email,
      name,
      picture,
      plan = 'basic',
      google_id,
      stripe_customer_id,
      stripe_subscription_id
    } = userData;

    const query = `
      INSERT INTO users (
        email, 
        name, 
        picture_url, 
        plan_type, 
        google_id, 
        stripe_customer_id,
        stripe_subscription_id,
        subscription_status,
        created_at,
        role
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), 'parent')
      RETURNING *
    `;

    const values = [
      email,
      name,
      picture,
      plan || 'basic',
      google_id,
      stripe_customer_id,
      stripe_subscription_id
    ];

    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async handleStripeWebhook(userData) {
    let user = await this.findByEmail(userData.email);
    if (!user) {
      user = await this.create(userData);
    } else {
      const query = `
        UPDATE users 
        SET 
          stripe_customer_id = $1,
          stripe_subscription_id = $2,
          plan_type = $3,
          subscription_status = $4,
          subscription_end_date = $5,
          updated_at = NOW()
        WHERE id = $6
        RETURNING *
      `;
      
      const values = [
        userData.stripe_customer_id,
        userData.stripe_subscription_id,
        userData.plan,
        userData.subscription_status,
        userData.subscription_end_date,
        user.id
      ];
  
      const { rows } = await pool.query(query, values);
      user = rows[0];
    }
    return user;
  }
  
  
  static async handleSubscriptionUpdate(subscription) {
    const priceId = subscription.items.data[0].price.id;
    const planMap = {
      'price_1QP9N4DII9A9349ohlOJgJEE': 'single',
      'price_1QP9NLDII9A9349oDRxFpdWx': 'familypro'
    };
    
    const planType = planMap[priceId];
    const query = `
      UPDATE users 
      SET 
        plan_type = $1,
        subscription_status = $2,
        stripe_subscription_id = $3,
        updated_at = NOW()
      WHERE stripe_customer_id = $4
      RETURNING *
    `;
    
    const values = [
      planType,
      subscription.status,
      subscription.id,
      subscription.customer
    ];

    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async updateStripeInfo(userId, stripeData) {
    const {
      customerId,
      subscriptionId,
      status,
      endDate
    } = stripeData;

    const query = `
      UPDATE users 
      SET 
        stripe_customer_id = $1,
        stripe_subscription_id = $2,
        subscription_status = $3,
        subscription_end_date = $4,
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `;

    const values = [
      customerId,
      subscriptionId,
      status,
      endDate,
      userId
    ];

    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async findByStripeCustomerId(stripeCustomerId) {
    const query = 'SELECT * FROM users WHERE stripe_customer_id = $1';
    const { rows } = await pool.query(query, [stripeCustomerId]);
    return rows[0];
  }
}

module.exports = User;
