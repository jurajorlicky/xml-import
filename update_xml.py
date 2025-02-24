import os
import requests
import xml.etree.ElementTree as ET
from supabase import create_client, Client
import base64

# 🛠️ Načítanie environment premenných
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")

# Inicializácia Supabase klienta
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# 1️⃣ **Stiahnutie aktuálneho XML feedu**
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
data, error = supabase.from_("product_price_view").select("size, final_price, final_status").execute()

if error:
    raise Exception(f"❌ Chyba pri načítaní dát zo Supabase: {error}")

# Mapovanie dát na úpravu XML (podľa veľkosti)
price_map = {str(row["size"]): (row["final_price"], row["final_status"]) for row in data[1]}

# 3️⃣ **Aktualizácia cien v XML**
for product in root.findall(".//VARIANT"):
    size_element = product.find(".//PARAMETERS//PARAMETER//VALUE")
    price_element = product.find("PRICE_VAT")
    status_element = product.find("AVAILABILITY_OUT_OF_STOCK")

    if size_element is not None and price_element is not None and status_element is not None:
        size = size_element.text.strip()

        if size in price_map:
            new_price, new_status = price_map[size]
            price_element.text = str(new_price)
            status_element.text = new_status

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
