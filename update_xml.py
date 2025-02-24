import os
import requests
import xml.etree.ElementTree as ET
from supabase import create_client
import base64

# 🛠️ Načítanie environment premenných
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")

# Debug výpis, či sa načítali premenné
print("🔍 Debug - SUPABASE_URL:", SUPABASE_URL)
print("🔍 Debug - SUPABASE_KEY:", SUPABASE_KEY[:5] + "..." + SUPABASE_KEY[-5:])  # Maskovanie pre bezpečnosť

# Inicializácia Supabase klienta
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ✅ **Test spojenia so Supabase** - skúšame načítať testovaciu tabuľku `profiles`
print("🔍 Testujem spojenie so Supabase...")
response = supabase.from_("profiles").select("*").limit(1).execute()
print("🔍 Supabase Response (profiles):", response)

# 1️⃣ **Stiahnutie aktuálneho XML feedu z GitHubu**
GITHUB_REPO = "jurajorlicky/xml-import"
GITHUB_FILE_PATH = "feed.xml"
GITHUB_API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/contents/{GITHUB_FILE_PATH}"

headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
response = requests.get(GITHUB_API_URL, headers=headers)

if response.status_code != 200:
    raise Exception(f"❌ Chyba pri sťahovaní XML: {response.json()}")

# Dekódovanie obsahu XML
file_data = response.json()
xml_content = base64.b64decode(file_data["content"]).decode("utf-8")

# Načítanie XML
tree = ET.ElementTree(ET.fromstring(xml_content))
root = tree.getroot()

# 2️⃣ **Načítanie aktuálnych cien a statusov z Supabase**
print("🔍 Načítavam dáta z `product_price_view`...")
response = supabase.from_("product_price_view").select("product_id, size, final_price, final_status").execute()
print("🔍 Supabase Response:", response)

data, error = response

if error:
    raise Exception(f"❌ Chyba pri načítaní dát zo Supabase: {error}")

# Mapovanie dát na úpravu XML
price_map = {(str(row["product_id"]), str(row["size"])): (row["final_price"], row["final_status"]) for row in data}

# 3️⃣ **Aktualizácia cien v XML**
for product in root.findall("SHOPITEM"):
    product_id = product.find("PRODUCTNO").text
    size = product.find("SIZE").text

    if (product_id, size) in price_map:
        new_price, new_status = price_map[(product_id, size)]
        product.find("PRICE").text = str(new_price)
        product.find("STATUS").text = new_status

# 4️⃣ **Uloženie upraveného XML**
tree.write("feed.xml", encoding="utf-8", xml_declaration=True)

# 5️⃣ **Nahratie súboru na GitHub**
update_data = {
    "message": "Manuálna aktualizácia XML",
    "content": base64.b64encode(open("feed.xml", "rb").read()).decode("utf-8"),
    "sha": file_data["sha"],
}

upload_response = requests.put(GITHUB_API_URL, headers=headers, json=update_data)

if upload_response.status_code != 200:
    raise Exception(f"❌ Chyba pri nahrávaní XML na GitHub: {upload_response.json()}")

print("✅ XML feed bol úspešne aktualizovaný.")
