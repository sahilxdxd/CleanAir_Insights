const mongoose = require("mongoose");

const loginActivitySchema = new mongoose.Schema({
    userId: { type: String, required: true },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    action: { type: String, enum: ["login", "logout"], required: true },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" }
}, { timestamps: true });

module.exports = mongoose.models.LoginActivity || mongoose.model("LoginActivity", loginActivitySchema);
