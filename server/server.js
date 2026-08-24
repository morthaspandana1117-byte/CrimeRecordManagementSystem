require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const User = require("./models/User");
const Officer = require("./models/Officer");

const app = express();

app.use(cors());
app.use(express.json());

connectDB();

app.get("/", (req, res) => {
    res.send("CRMS Backend is running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`CRMS Backend running on port ${PORT}`);
});