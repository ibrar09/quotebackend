import express from 'express';
import * as notificationController from '../controllers/notification.controller.js';

const router = express.Router();

router.get('/', notificationController.getNotifications);
router.get('/count', notificationController.getUnreadCount);
router.put('/:id/read', notificationController.markAsRead);
router.delete('/:id', notificationController.deleteNotification);
router.post('/generate', notificationController.generateNotifications); // Manual trigger

// Test Route to force create a notification
router.post('/test', async (req, res) => {
    try {
        const { Notification } = await import('../models/index.js');
        const notif = await Notification.create({
            type: 'INCOMPLETE_DATA',
            priority: 'HIGH',
            message: '🔔 TEST NOTIFICATION: System is working!',
            quote_no: 'TEST-123',
            days_elapsed: 0
        });
        res.json({ success: true, data: notif });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

export default router;
