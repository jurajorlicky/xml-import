const fs = require('fs');
const axios = require('axios');
const { parseStringPromise, Builder } = require('xml2js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// 🛠️ Načítanie environment premenných
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "jurajorlicky/xml-import";
const GITHUB_FILE_PATH = "feed.xml";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`;

// Inicializácia Supabase klienta
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🔹 Stiahni XML feed zo súboru alebo z GitHubu
async function fetchXMLFromGitHub() {
    try {
        console.log("📥 Sťahujem XML feed z GitHubu...");
        const response = await axios.get(GITHUB_API_URL, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` }
        });

        const xmlContent = Buffer.from(response.data.content, 'base64').toString('utf-8');
        console.log("✅ XML feed úspešne stiahnutý!");
        return { xmlContent, sha: response.data.sha };
    } catch (error) {
        console.error("❌ Chyba pri sťahovaní XML:", error.response?.data || error.message);
        return null;
    }
}

// 🔹 Načíta dáta z Supabase
async function fetchPricesFromSupabase() {
    console.log("📡 Načítavam ceny a dostupnosť z Supabase...");
    const { data, error } = await supabase
        .from("product_price_view")
        .select("size, final_price, final_status");

    if (error) {
        console.error("❌ Chyba pri načítaní dát zo Supabase:", error);
        return null;
    }

    console.log("✅ Dáta z Supabase úspešne načítané!", data.length, "záznamov");
    console.log("🔍 Debug - Údaje zo Supabase:", data);

    return data.reduce((acc, row) => {
        acc[row.size.trim()] = { price: row.final_price, status: row.final_status };
        return acc;
    }, {});
}

// 🔹 Aktualizuje ceny a dostupnosť v XML
async function updateXML(xmlContent, priceMap) {
    console.log("🔄 Aktualizujem XML feed...");
    const parsedXML = await parseStringPromise(xmlContent);
    let changes = 0;

    parsedXML.SHOP.SHOPITEM.forEach(item => {
        if (item.VARIANTS && item.VARIANTS[0].VARIANT) {
            item.VARIANTS[0].VARIANT.forEach(variant => {
                if (variant.PARAMETERS && variant.PARAMETERS[0].PARAMETER) {
                    const size = variant.PARAMETERS[0].PARAMETER[0].VALUE[0].trim();

                    console.log(`🔍 Debug - Produkt ${size} pred úpravou: ${JSON.stringify(variant)}`);

                    if (priceMap[size]) {
                        console.log(`✅ Aktualizujem veľkosť ${size}: cena ${priceMap[size].price}, status ${priceMap[size].status}`);
                        
                        variant.PRICE_VAT[0] = String(priceMap[size].price);

                        if (variant.AVAILABILITY_OUT_OF_STOCK) {
                            variant.AVAILABILITY_OUT_OF_STOCK[0] = priceMap[size].status;
                        } else if (variant.AVAILABILITY) {
                            variant.AVAILABILITY[0] = priceMap[size].status;
                        } else {
                            console.log(`⚠️ Chýba tag pre dostupnosť pre veľkosť ${size}`);
                        }

                        changes++;
                    } else {
                        console.log(`⚠️ Veľkosť ${size} nebola nájdená v Supabase.`);
                    }
                }
            });
        }
    });

    if (changes === 0) {
        console.log("⚠️ Neboli vykonané žiadne zmeny v XML. Skontroluj veľkosti v Supabase.");
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

    const encodedContent = Buffer.from(updatedXML).toString('base64');

    const updateData = {
        message: "Automatická aktualizácia XML feedu",
        content: encodedContent,
        sha
    };

    try {
        await axios.put(GITHUB_API_URL, updateData, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` }
        });

        console.log("✅ XML feed bol úspešne aktualizovaný na GitHube.");
    } catch (error) {
        console.error("❌ Chyba pri nahrávaní XML na GitHub:", error.response?.data || error.message);
    }
}

// 🔹 Hlavná funkcia
async function main() {
    const xmlData = await fetchXMLFromGitHub();
    if (!xmlData) return;

    const priceMap = await fetchPricesFromSupabase();
    if (!priceMap) return;

    const updatedXML = await updateXML(xmlData.xmlContent, priceMap);
    await uploadXMLToGitHub(updatedXML, xmlData.sha);
}

main();
