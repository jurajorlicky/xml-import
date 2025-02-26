const fs = require("fs");
const axios = require("axios");
const { parseStringPromise, Builder } = require("xml2js");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// 🔹 Konštanty
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "jurajorlicky/xml-import";
const GITHUB_FILE_PATH = "feed.xml";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;

// 🔹 Inicializácia Supabase klienta
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🔹 Stiahni XML feed z GitHubu
async function fetchXMLFromGitHub() {
  try {
    console.log("📥 Sťahujem XML feed z GitHubu...");
    const response = await axios.get(GITHUB_API_URL, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
    });

    const xmlContent = Buffer.from(response.data.content, "base64").toString("utf-8");
    console.log("✅ XML feed úspešne stiahnutý!");
    return { xmlContent, sha: response.data.sha };
  } catch (error) {
    console.error("❌ Chyba pri sťahovaní XML:", error.response?.data || error.message);
    return null;
  }
}

// 🔹 Načíta dáta z Supabase (product_id + size)
async function fetchPricesFromSupabase() {
  console.log("📡 Načítavam ceny a dostupnosť z Supabase...");
  const { data, error } = await supabase
    .from("product_price_view")
    .select("product_id, size, final_price, final_status");

  if (error) {
    console.error("❌ Chyba pri načítaní dát zo Supabase:", error);
    return null;
  }

  console.log("✅ Dáta z Supabase úspešne načítané!", data.length, "záznamov");
  console.log("🔍 Debug - Údaje zo Supabase:", data);

  // Vytvoríme mapu, kde kľúč = "product_id|size"
  const priceMap = {};
  for (const row of data) {
    const key = `${row.product_id}|${row.size.trim()}`;
    priceMap[key] = {
      price: row.final_price,
      status: row.final_status
    };
  }
  return priceMap;
}

// 🔹 Aktualizuje ceny a dostupnosť v XML
async function updateXML(xmlContent, priceMap) {
  console.log("🔄 Aktualizujem XML feed...");
  const parsedXML = await parseStringPromise(xmlContent);
  let changes = 0;

  // Prechádzame každý SHOPITEM (product)
  parsedXML.SHOP.SHOPITEM.forEach((item) => {
    // product_id z <SHOPITEM id="xxx">
    const productId = item.$.id;  // napr. "706", "435" atď.

    // Overíme, či existuje <VARIANTS>
    if (item.VARIANTS && item.VARIANTS[0].VARIANT) {
      // Prechádzame všetky varianty
      item.VARIANTS[0].VARIANT.forEach((variant) => {
        if (variant.PARAMETERS && variant.PARAMETERS[0].PARAMETER) {
          // Veľkosť z <VALUE>
          const size = variant.PARAMETERS[0].PARAMETER[0].VALUE[0].trim();
          console.log(`🔍 Debug - product_id=${productId}, size=${size} pred úpravou: ${JSON.stringify(variant)}`);

          // Kľúč v priceMap
          const key = `${productId}|${size}`;

          // Skontrolujeme, či existuje v priceMap
          if (priceMap[key]) {
            console.log(`✅ Aktualizujem product_id=${productId}, size=${size}: cena ${priceMap[key].price}, status ${priceMap[key].status}`);

            // Nastav cenu
            variant.PRICE_VAT[0] = String(priceMap[key].price);

            // Nastav status
            if (variant.AVAILABILITY_OUT_OF_STOCK) {
              variant.AVAILABILITY_OUT_OF_STOCK[0] = priceMap[key].status;
            } else if (variant.AVAILABILITY) {
              variant.AVAILABILITY[0] = priceMap[key].status;
            } else {
              console.log(`⚠️ Chýba tag pre dostupnosť pre product_id=${productId}, size=${size}`);
            }
            changes++;
          } else {
            console.log(`⚠️ Nenašiel som kľúč ${key} v priceMap`);
          }
        }
      });
    }
  });

  if (changes === 0) {
    console.log("⚠️ Neboli vykonané žiadne zmeny v XML. Skontroluj product_id a size v Supabase.");
  } else {
    console.log(`✅ Počet aktualizovaných záznamov: ${changes}`);
  }

  const builder = new Builder();
  return builder.buildObject(parsedXML);
}

// 🔹 Nahraje XML na GitHub
async function uploadXMLToGitHub(updatedXML, sha) {
  console.log("📤 Nahrávam aktualizovaný XML feed na GitHub...");
  console.log("🔍 Debug - XML tesne pred uploadom:", updatedXML.substring(0, 500));
  console.log("🔍 Debug - SHA starého súboru:", sha);

  const encodedContent = Buffer.from(updatedXML).toString("base64");

  const updateData = {
    message: "Automatická aktualizácia XML feedu",
    content: encodedContent,
    sha,
  };

  try {
    await axios.put(GITHUB_API_URL, updateData, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
    });

    console.log("✅ XML feed bol úspešne aktualizovaný na GitHube.");
  } catch (error) {
    console.error("❌ Chyba pri nahrávaní XML na GitHub:", error.response?.data || error.message);
  }
}

// 🔹 Hlavná funkcia
async function main() {
  // 1. Stiahni XML
  const xmlData = await fetchXMLFromGitHub();
  if (!xmlData) return;

  // 2. Načítaj mapu cien a statusov zo Supabase (product_id + size)
  const priceMap = await fetchPricesFromSupabase();
  if (!priceMap) return;

  // 3. Aktualizuj XML
  const updatedXML = await updateXML(xmlData.xmlContent, priceMap);

  // 4. Nahraj upravené XML na GitHub
  await uploadXMLToGitHub(updatedXML, xmlData.sha);
}

main();
