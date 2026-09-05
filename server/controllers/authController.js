const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Username and password are required",
                error: "MISSING_CREDENTIALS",
            });
        }

        const identifier = username.trim();
        const user = await User.findOne({
            $or: [{ username: identifier }, { email: identifier.toLowerCase() }],
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password",
                error: "INVALID_CREDENTIALS",
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: "User account is inactive",
                error: "ACCOUNT_INACTIVE",
            });
        }

        const isPasswordValid = await bcrypt.compare(
            password,
            user.passwordHash,
        );

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password",
                error: "INVALID_CREDENTIALS",
            });
        }

        // Existing user documents created before approval was introduced do
        // not have this field and remain able to sign in as approved users.
        const accountStatus = user.status || "approved";
        if (user.role === "officer" && accountStatus === "pending") {
            return res.status(403).json({
                success: false,
                message: "Your account is pending admin approval.",
                error: "ACCOUNT_PENDING_APPROVAL",
            });
        }

        if (user.role === "officer" && accountStatus === "rejected") {
            return res.status(403).json({
                success: false,
                message: "Your account was not approved. Please contact an administrator.",
                error: "ACCOUNT_REJECTED",
            });
        }

        const token = jwt.sign(
            {
                userId: user._id,
                username: user.username,
                role: user.role,
                status: accountStatus,
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1d",
            },
        );

        res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                status: accountStatus,
            },
        });
    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "Server error during login",
            error: "LOGIN_ERROR",
        });
    }
};

const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select(
            "-passwordHash",
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
                error: "USER_NOT_FOUND",
            });
        }

        res.status(200).json({
            success: true,
            data: {
                id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                status: user.status || "approved",
                isActive: user.isActive,
            },
        });
    } catch (error) {
        console.error("Get current user error:", error);

        res.status(500).json({
            success: false,
            message: "Server error while fetching user",
            error: "GET_USER_ERROR",
        });
    }
};

module.exports = {
    login,
    getMe,
};
