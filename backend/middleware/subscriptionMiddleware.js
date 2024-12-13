const checkSubscription = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (req.user.subscription_status === 'canceled') {
            const endDate = new Date(req.user.subscription_end_date);

            if (Date.now() > endDate) {
                return res.status(403).json({
                    success: false,
                    error: 'Subscription expired',
                    message: 'Please renew your subscription to continue'
                });
            }
        }

        next();
    } catch (error) {
        console.error('Error in subscription check:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error checking subscription status'
        });
    }
};

module.exports = { checkSubscription };
