const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: "secretkey",
        resave: false,
        saveUninitialized: true
    })
);

app.use(express.static("public"));

mongoose
    .connect("mongodb://localhost:27017/aqi_app")
    .then(() => console.log("MongoDB Connected"))
    .catch((err) => console.log(err));

const authRoutes = require("./routes/auth");
const predictRoutes = require("./routes/predict");
const adminRoutes = require("./routes/admin");

app.use("/", authRoutes);
app.use("/", predictRoutes);
app.use("/", adminRoutes);

app.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});