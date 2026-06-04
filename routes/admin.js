const express = require("express");
const router = express.Router();
const path = require("path");

const User = require("../models/User");
const Prediction = require("../models/Prediction");
const LoginActivity = require("../models/LoginActivity");

function ensureAdmin(req, res) {
    if (!req.session.user || req.session.user.role !== "admin") {
        res.status(403).json({ success: false, message: "Access denied" });
        return false;
    }
    return true;
}

router.get("/admin", (req, res) => {
    if (!req.session.user || req.session.user.role !== "admin") {
        return res.redirect("/login");
    }

    res.sendFile(path.join(__dirname, "../views/admin.html"));
});

router.get("/admin/data", async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const [users, predictions, loginActivities] = await Promise.all([
            User.find().sort({ createdAt: -1 }).lean(),
            Prediction.find().sort({ createdAt: -1 }).lean(),
            LoginActivity.find().sort({ createdAt: -1 }).limit(120).lean()
        ]);

        const userMap = new Map(users.map((u) => [String(u._id), u]));

        const enrichedPredictions = predictions.map((p) => {
            const user = userMap.get(String(p.userId));
            return {
                ...p,
                userName: user?.name || "User",
                userEmail: user?.email || ""
            };
        });

        const enrichedActivities = loginActivities.map((a) => {
            const user = userMap.get(String(a.userId));
            return {
                ...a,
                userName: user?.name || a.name || "User",
                userEmail: user?.email || a.email || ""
            };
        });

        res.json({
            success: true,
            users,
            predictions: enrichedPredictions,
            loginActivities: enrichedActivities
        });
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Unable to load admin data" });
    }
});

router.get("/admin/data/csv", async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const [users, predictions] = await Promise.all([
            User.find().lean(),
            Prediction.find().sort({ createdAt: -1 }).lean()
        ]);

        const userMap = new Map(users.map((u) => [String(u._id), u]));

        // CSV Header
        let csvStr = "Date,User Name,User Email,City,State,Mode,AQI Status,AQI Score\n";

        // CSV Rows
        predictions.forEach((p) => {
            const user = userMap.get(String(p.userId));
            const userName = user?.name || "User";
            const userEmail = user?.email || "";
            const date = p.createdAt ? new Date(p.createdAt).toISOString() : "";
            
            // Escape fields for CSV if they contain commas
            const escapeCSV = (field) => {
                if (field == null) return '""';
                const str = String(field);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };

            const row = [
                escapeCSV(date),
                escapeCSV(userName),
                escapeCSV(userEmail),
                escapeCSV(p.city),
                escapeCSV(p.state),
                escapeCSV(p.mode),
                escapeCSV(p.aqiStatus),
                escapeCSV(p.aqiScore)
            ].join(",");

            csvStr += row + "\n";
        });

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="predictions_data.csv"');
        res.send(csvStr);
    } catch (err) {
        console.log(err);
        res.status(500).send("Unable to generate CSV");
    }
});

// DELETE a user and all their associated data
router.delete("/admin/user/:id", async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const userId = req.params.id;

        // Prevent admin from deleting themselves
        if (String(req.session.user._id) === userId) {
            return res.status(400).json({ success: false, message: "You cannot delete your own account." });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        // Delete all predictions and login activity belonging to this user
        await Promise.all([
            Prediction.deleteMany({ userId: String(userId) }),
            LoginActivity.deleteMany({ userId: String(userId) }),
            User.findByIdAndDelete(userId)
        ]);

        res.json({ success: true, message: `User "${user.name}" and all their data deleted.` });
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Failed to delete user." });
    }
});

// DELETE a single prediction record
router.delete("/admin/prediction/:id", async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const prediction = await Prediction.findByIdAndDelete(req.params.id);
        if (!prediction) {
            return res.status(404).json({ success: false, message: "Prediction not found." });
        }

        res.json({ success: true, message: "Prediction deleted." });
    } catch (err) {
        console.log(err);
        res.status(500).json({ success: false, message: "Failed to delete prediction." });
    }
});

module.exports = router;
