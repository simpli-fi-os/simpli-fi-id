/**
 * Simpli-FI Backend: Reactive Notion Sync
 * Trigger: Fires automatically when a user is created in Firestore.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Client } = require('@notionhq/client');

admin.initializeApp();

// Initialize Notion Client securely
// Remember to set keys: firebase functions:config:set notion.key="..." notion.db_id="..."
const notion = new Client({ auth: functions.config().notion.key });
const NOTION_DB_ID = functions.config().notion.db_id;

exports.syncToNotion = functions.firestore
    .document('users/{userId}')
    .onCreate(async (snap, context) => {
        
        const userData = snap.data();
        const userId = context.params.userId;

        console.log(`New User Detected: ${userId}. Starting sync...`);

        // 0. VALIDATION (Save API calls if data is garbage)
        if (!userData.full_name) {
            console.warn(`⚠️ Skipped ${userId}: Missing 'full_name'.`);
            return null; // Stop execution, do not retry
        }

        // 1. SAFE DATE HANDLING (Fixes "Date Crash" Bug)
        let startDate;
        try {
            // Check if created_at exists and is a valid Firestore Timestamp
            if (userData.created_at && typeof userData.created_at.toDate === 'function') {
                startDate = userData.created_at.toDate().toISOString();
            } else {
                // Fallback for string dates, nulls, or manual entries
                startDate = new Date().toISOString();
            }
        } catch (e) {
            console.warn("Date parsing error, defaulting to now:", e);
            startDate = new Date().toISOString();
        }

        // 2. DATA NORMALIZATION (Fixes Strict Typing)
        // Forces tier to lowercase to prevent "Pro" vs "pro" duplicates in Notion
        const tierValue = (userData.tier || "free").toLowerCase(); 

        try {
            // Map Firestore fields to Notion Properties
            // Ensure Notion columns match EXACTLY: Name, Email, Phone, Status, Tier, Card URL, Start Date
            await notion.pages.create({
                parent: { database_id: NOTION_DB_ID },
                properties: {
                    "Name": {
                        title: [
                            { text: { content: userData.full_name || "Unknown User" } }
                        ]
                    },
                    "Email": {
                        email: userData.email || ""
                    },
                    "Phone": {
                        phone_number: userData.phone || ""
                    },
                    "Status": {
                        select: { name: "New Lead" }
                    },
                    "Tier": {
                        select: { name: tierValue }
                    },
                    "Card URL": {
                        url: `https://id.simpli-fi-os.com/${userId}`
                    },
                    "Start Date": {
                        date: { start: startDate }
                    }
                }
            });

            console.log(`✅ Success: Synced ${userId} to Notion.`);
            return null;

        } catch (error) {
            // ENHANCED LOGGING: Log the specific Notion error code and body for easier debugging
            console.error("❌ Notion Sync Failed:", error.code, error.message);
            if (error.body) {
                console.error("Error Body:", JSON.stringify(error.body));
            }
            
            // 3. VIRAL SPIKE HANDLING (Rate Limits)
            // If Notion sends a 429 error, we THROW an error.
            // This triggers Google Cloud's "Retry on failure" mechanism to try again later.
            // We do NOT sleep here to avoid paying for idle execution time.
            if (error.status === 429) {
                throw new Error("Notion Rate Limit Hit - Triggering Cloud Retry...");
            }
            
            // For other errors (bad data, missing columns), we return null to stop infinite loops.
            return null;
        }
    });
