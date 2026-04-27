import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface OutfitSuggestion {
  outfitType: "Casual" | "Business" | "Night Out";
  description: string;
  complementaryItems: string[];
  imagePrompt: string;
}

export interface StylingAnalysis {
  itemDescription: string;
  itemType: string;
  colorPalette: string[];
  style: string;
  outfits: OutfitSuggestion[];
}

export async function analyzeGarment(base64Image: string, mimeType: string): Promise<StylingAnalysis> {
  const prompt = `Analyze this clothing item found in the image. 
  1. Identify the item type, color palette, and style.
  2. Create 3 distinct complete outfits (Casual, Business, Night Out) that feature this specific item.
  3. For each outfit, provide a name, a short description, a list of complementary items (shoes, accessories, other clothes), and a detailed prompt for generating a flat-lay photography style image of this outfit. 
  The image prompt should specifically mention a minimalist neutral background and high-fashion flat-lay composition.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { inlineData: { data: base64Image, mimeType } },
          { text: prompt }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["itemDescription", "itemType", "colorPalette", "style", "outfits"],
        properties: {
          itemDescription: { type: Type.STRING },
          itemType: { type: Type.STRING },
          colorPalette: { type: Type.ARRAY, items: { type: Type.STRING } },
          style: { type: Type.STRING },
          outfits: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["outfitType", "description", "complementaryItems", "imagePrompt"],
              properties: {
                outfitType: { type: Type.STRING, enum: ["Casual", "Business", "Night Out"] },
                description: { type: Type.STRING },
                complementaryItems: { type: Type.ARRAY, items: { type: Type.STRING } },
                imagePrompt: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return JSON.parse(text);
}

export async function generateOutfitImage(prompt: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: {
      parts: [{ text: prompt }]
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
      }
    }
  });

  const imagePart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData);
  if (!imagePart || !imagePart.inlineData) {
    throw new Error("Failed to generate image");
  }

  return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
}

export async function generateDailyInspiration(): Promise<OutfitSuggestion> {
  const prompt = `Generate a random, highly stylish outfit suggestion for a "Daily Pick" feature. 
  It should be one of: Casual, Business, or Night Out.
  Provide a vivid description, a list of 4 complementary items, and a detailed image generation prompt for a flat-lay photography style image.
  The image prompt must be in high-fashion flat-lay style with minimalist background.`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ text: prompt }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["outfitType", "description", "complementaryItems", "imagePrompt"],
        properties: {
          outfitType: { type: Type.STRING, enum: ["Casual", "Business", "Night Out"] },
          description: { type: Type.STRING },
          complementaryItems: { type: Type.ARRAY, items: { type: Type.STRING } },
          imagePrompt: { type: Type.STRING }
        }
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from AI");
  return JSON.parse(text);
}
