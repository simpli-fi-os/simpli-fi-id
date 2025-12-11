/**
 * Simpli-FI Backend: Dual-Database Write
 * Agent: Sparky (Backend Architect)
 * * This Cloud Function is the "Traffic Controller".
 * It receives the form data and pipes it to:
 * 1. Firebase Firestore (Production/Freemium Card)
 * 2. Notion API (CRM/War Room)
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { Client } = require("@notionhq/client"); // npm install @notionhq/client

admin.initializeApp();
const db = admin.firestore();

// Initialize Notion Client (Securely accesses env variables)
// Run: firebase functions:config:set notion.key="secret_..." notion.db_id="..."
const notion = new Client({ auth: functions.config().notion.key });
const NOTION_DB_ID = functions.config().notion.db_id;

exports.submitIntake = functions.https.onCall(async (data, context) => {
  
  // 1. Prepare Data Object
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const userId = `${data.firstName.toLowerCase()}_${data.lastName.toLowerCase()}_${Date.now().toString().slice(-4)}`; // Generate simple slug

  const userPayload = {
    full_name: `${data.firstName} ${data.lastName}`,
    title: data.title,
    mission: data.mission,
    email: data.email,
    phone: data.phone,
    tier: "free", // Default to freemium
    social_links: {
        website: data.website
    },
    created_at: timestamp,
    crm_status: "new_lead"
  };

  try {
    // --- PIPE A: WRITE TO FIREBASE (The Factory) ---
    // This immediately enables the card to be live at simpli-fi-id.com?u=userId
    await db.collection("users").doc(userId).set(userPayload);


    // --- PIPE B: WRITE TO NOTION (The War Room) ---
    // This pushes the lead to your CRM so you can track LTV/CAC manually
    await notion.pages.create({
      parent: { database_id: NOTION_DB_ID },
      properties: {
        "Name": {
          title: [
            { text: { content: `${data.firstName} ${data.lastName}` } }
          ]
        },
        "Status": {
          select: { name: "New Lead" }
        },
        "Email": {
          email: data.email
        },
        "Phone": {
          phone_number: data.phone
        },
        "Tier": {
          select: { name: "Freemium" }
        },
        "Live Card URL": {
          url: `https://id.simpli-fi-os.com/card.html?u=${userId}`
        }
      }
    });

    return { success: true, message: "Identity Launched & CRM Updated", userId: userId };

  } catch (error) {
    console.error("Dual-Write Error:", error);
    // Even if Notion fails, we might want to let the Firebase write succeed, 
    // but for now, we throw to alert the user.
    throw new functions.https.HttpsError('internal', 'System Error: ' + error.message);
  }
});
