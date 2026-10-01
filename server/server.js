require("dotenv").config();

const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const connectDB = require("./config/db");
const createApp = require("./app");

const app = createApp();

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";

connectDB().then(() => {
    app.listen(PORT, HOST, () => {
        console.log(`CRMS Backend running on http://${HOST}:${PORT}`);
    });
});
