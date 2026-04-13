const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, default: "user" },
    lastLoginAt: { type: Date, default: null },
    loginCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
