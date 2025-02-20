async function fetchAndProcessXML() {
    try {
        console.log("🚀 Fetching latest XML feed...");
        const response = await fetch(xmlUrl, { headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const xmlContent = await response.text();

        console.log("🔍 Parsing XML...");
        const parsedData = await parseStringPromise(xmlContent, { explicitArray: true });
        const items = parsedData.SHOP.SHOPITEM || [];

        console.log("📡 Fetching existing products from Supabase...");
        const { data: existingProducts, error: fetchError } = await supabase
            .from('products')
            .select('id');

        if (fetchError) {
            console.error("❌ Error fetching existing products:", fetchError);
            return;
        }

        const existingProductIds = new Set(existingProducts.map(p => p.id));

        let newProducts = [];
        for (const item of items) {
            const productId = item.$.id;
            const name = item.NAME?.[0] || "Unknown";

            if (!existingProductIds.has(productId)) {
                console.log(`🆕 Adding new product: ${name} (${productId})`);
                newProducts.push({ id: productId, name });
            } else {
                console.log(`⚠️ Skipping existing product: ${name} (${productId})`);
            }
        }

        // 🛠 Pridáme iba nové produkty
        if (newProducts.length > 0) {
            console.log(`🚀 Inserting ${newProducts.length} new products...`);
            const { error: insertError } = await supabase.from('products').insert(newProducts);
            if (insertError) console.error("❌ Error inserting products:", insertError);
            else console.log(`✅ Inserted ${newProducts.length} new products.`);
        } else {
            console.log("✅ No new products to insert.");
        }
    } catch (error) {
        console.error("❌ Error processing XML:", error);
    }
}

fetchAndProcessXML();
