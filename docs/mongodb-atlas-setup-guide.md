# 🍃 How to Create a Free Database in MongoDB Atlas

Follow this step-by-step guide to set up your free MongoDB Atlas database, get your connection string (`MONGODB_URI`), and configure Vector Search for your RAG system.

---

## 📌 Step 1: Create a Free MongoDB Atlas Account

1. Go to [https://www.mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas).
2. Click **Try Free** or **Log In** (you can sign in with your Google account).

---

## 📌 Step 2: Create a Free Cluster (M0 Tier)

1. Click **Create** or **Build a Database**.
2. Select the **M0 FREE** tier (100% free forever, no credit card required).
3. Choose a Provider & Region (e.g. **AWS** / **Mumbai `ap-south-1`** for fast latency in India).
4. Leave Cluster Name as `Cluster0` or name it `gig-tax-cluster`.
5. Click **Create Cluster**.

---

## 📌 Step 3: Create a Database User (Username & Password)

1. In the left sidebar under **Security**, click **Database Access**.
2. Click the green **+ Add New Database User** button.
3. Choose **Password** for Authentication.
4. Set a Username (e.g., `gig_admin`) and a Password (e.g., `Hackathon123!`).
   *(⚠️ Save these credentials! You will need them for your connection string)*.
5. Under **Database User Privileges**, choose **Read and write to any database**.
6. Click **Add User**.

---

## 📌 Step 4: Configure Network Access (Allow IP Connection)

1. In the left sidebar under **Security**, click **Network Access**.
2. Click **+ Add IP Address**.
3. Click the **ALLOW ACCESS FROM ANYWHERE** button (this sets `0.0.0.0/0`, allowing your Express server to connect from anywhere).
4. Click **Confirm**.

---

## 📌 Step 5: Get Your Connection String (`MONGODB_URI`)

1. In the left sidebar, click **Database**.
2. Click the **Connect** button next to your cluster (`Cluster0`).
3. Choose **Drivers** (Node.js).
4. Copy the connection string provided. It will look like this:
   ```text
   mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
   ```
5. Open your [`.env`](file:///home/ankur-asrani/hackathon/.env) file in VS Code and paste it, adding your actual password and database name `gig_tax_db`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
MONGODB_URI=mongodb+srv://gig_admin:Hackathon123!@cluster0.abcde.mongodb.net/gig_tax_db?retryWrites=true&w=majority
```

---

## 📌 Step 6: Ingest Vector Tax Rules into MongoDB

Once your `.env` is updated, run the ingestion command in your terminal:

```bash
cd /home/ankur-asrani/hackathon
npm run ingest:mongo
```

Output:
```text
🍃 Uploading Vector-Indexed Tax Rules to MongoDB
⏳ Connecting to MongoDB...
✅ Connected to MongoDB successfully!
   ✅ Upserted rule [1/15]: "Presumptive Taxation for Non-Specified Businesses..."
   ...
🎉 MongoDB Ingestion Complete!
📊 Total Tax Rules Saved to MongoDB: 15
```

---

## 📌 Step 7: Create Atlas Vector Search Index (For Sub-Millisecond Search)

1. In MongoDB Atlas left sidebar, click **Atlas Search** or **Vector Search**.
2. Click **Create Search Index**.
3. Select **JSON Editor** under **Atlas Vector Search**.
4. Select Database `gig_tax_db` and Collection `taxrules`.
5. Name the index: `vector_index`.
6. Paste the following JSON configuration:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 768,
      "similarity": "cosine"
    }
  ]
}
```

7. Click **Next** and then **Create Search Index**.

---

🎉 **Done!** Your MongoDB Atlas database is now fully configured and running vector search!
