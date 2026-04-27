import React, { useState, useRef, useEffect, type ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload as UploadIcon, 
  Sparkles, 
  Shirt, 
  Briefcase, 
  PartyPopper, 
  ArrowLeft,
  Loader2,
  CheckCircle2,
  Palette,
  Bookmark,
  History as HistoryIcon,
  LogIn,
  LogOut,
  User as UserIcon,
  Trash2,
  BookmarkCheck
} from 'lucide-react';
import { 
  analyzeGarment, 
  generateOutfitImage, 
  generateDailyInspiration,
  type StylingAnalysis, 
  type OutfitSuggestion 
} from './lib/gemini';
import { auth, signIn, logout, db, handleFirestoreError, OperationType } from './lib/firebase';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp, deleteDoc, doc, where, setDoc, getDoc } from 'firebase/firestore';

type Step = 'upload' | 'analyzing' | 'results' | 'wardrobe' | 'history';

interface EnhancedOutfit extends OutfitSuggestion {
  id?: string;
  imageUrl?: string;
  loadingImage?: boolean;
}

interface SavedHistory {
  id: string;
  itemType: string;
  itemDescription: string;
  baseItemImage: string;
  analysis: StylingAnalysis;
  createdAt: any;
}

interface DailyPickEntry {
  userId: string;
  date: string;
  outfit: EnhancedOutfit;
  source: 'wardrobe' | 'generated';
}

export default function App() {
  const [step, setStep] = useState<Step>('upload');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('');
  const [analysis, setAnalysis] = useState<StylingAnalysis | null>(null);
  const [outfits, setOutfits] = useState<EnhancedOutfit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [savedOutfits, setSavedOutfits] = useState<EnhancedOutfit[]>([]);
  const [history, setHistory] = useState<SavedHistory[]>([]);
  const [dailyPick, setDailyPick] = useState<DailyPickEntry | null>(null);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [loadingWardrobe, setLoadingWardrobe] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        fetchWardrobe(currentUser.uid);
        fetchHistory(currentUser.uid);
        fetchDailyPick(currentUser.uid);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchWardrobe = async (userId: string) => {
    try {
      const q = query(collection(db, 'users', userId, 'wardrobe'), orderBy('savedAt', 'desc'));
      const snapshot = await getDocs(q);
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as EnhancedOutfit));
      setSavedOutfits(items);
      return items;
    } catch (err) {
      console.error("Fetch wardrobe error", err);
      return [];
    }
  };

  const fetchDailyPick = async (userId: string) => {
    try {
      setLoadingDaily(true);
      const today = new Date().toISOString().split('T')[0];
      const docRef = doc(db, 'users', userId, 'dailyPicks', today);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setDailyPick(docSnap.data() as DailyPickEntry);
      } else {
        // Generate new pick
        let source: 'wardrobe' | 'generated' = 'generated';
        let outfitToSave: EnhancedOutfit;

        // Try wardrobe first if available
        const currentWardrobe = await fetchWardrobe(userId);
        if (currentWardrobe.length > 0) {
          const randomIndex = Math.floor(Math.random() * currentWardrobe.length);
          outfitToSave = currentWardrobe[randomIndex];
          source = 'wardrobe';
        } else {
          // Generate anew
          const generated = await generateDailyInspiration();
          const imageUrl = await generateOutfitImage(generated.imagePrompt);
          outfitToSave = { ...generated, imageUrl };
          source = 'generated';
        }

        const newPick: DailyPickEntry = {
          userId,
          date: today,
          outfit: outfitToSave,
          source
        };

        await setDoc(docRef, newPick);
        setDailyPick(newPick);
      }
    } catch (err) {
      console.error("Daily pick error", err);
    } finally {
      setLoadingDaily(false);
    }
  };

  const fetchHistory = async (userId: string) => {
    try {
      const q = query(collection(db, 'users', userId, 'history'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SavedHistory));
      setHistory(items);
    } catch (err) {
      console.error("Fetch history error", err);
    }
  };

  const handleLogin = async () => {
    try {
      await signIn();
    } catch (err) {
      setError("Login failed. Please check your browser's popup settings.");
    }
  };

  const saveToWardrobe = async (outfit: EnhancedOutfit) => {
    if (!user) {
      handleLogin();
      return;
    }
    try {
      setLoadingWardrobe(true);
      const path = `users/${user.uid}/wardrobe`;
      await addDoc(collection(db, path), {
        userId: user.uid,
        outfitType: outfit.outfitType,
        description: outfit.description,
        complementaryItems: outfit.complementaryItems,
        imageUrl: outfit.imageUrl,
        baseItemImage: selectedImage,
        savedAt: serverTimestamp()
      });
      await fetchWardrobe(user.uid);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/wardrobe`);
    } finally {
      setLoadingWardrobe(false);
    }
  };

  const saveToHistory = async (analysisData: StylingAnalysis, baseImage: string) => {
    if (!user) return;
    try {
      const path = `users/${user.uid}/history`;
      await addDoc(collection(db, path), {
        userId: user.uid,
        itemType: analysisData.itemType,
        itemDescription: analysisData.itemDescription,
        baseItemImage: baseImage,
        analysis: analysisData,
        createdAt: serverTimestamp()
      });
      await fetchHistory(user.uid);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/history`);
    }
  };

  const removeFromWardrobe = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'wardrobe', id));
      setSavedOutfits(prev => prev.filter(o => o.id !== id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/wardrobe/${id}`);
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file.');
      return;
    }

    setMimeType(file.type);
    const reader = new FileReader();
    reader.onload = (event) => {
      setSelectedImage(event.target?.result as string);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const startAnalysis = async () => {
    if (!selectedImage) return;

    setStep('analyzing');
    setError(null);

    try {
      const base64 = selectedImage.split(',')[1];
      const result = await analyzeGarment(base64, mimeType);
      setAnalysis(result);
      
      // Save to history if logged in
      if (user) {
        saveToHistory(result, selectedImage);
      }
      
      // Initialize outfits with loading state for images
      const initialOutfits = result.outfits.map(o => ({ ...o, loadingImage: true }));
      setOutfits(initialOutfits);
      setStep('results');

      // Generate images in parallel
      const imagePromises = initialOutfits.map(async (outfit, index) => {
        try {
          const imageUrl = await generateOutfitImage(outfit.imagePrompt);
          setOutfits(prev => prev.map((o, i) => i === index ? { ...o, imageUrl, loadingImage: false } : o));
        } catch (err) {
          console.error(`Failed to generate image for ${outfit.outfitType}`, err);
          setOutfits(prev => prev.map((o, i) => i === index ? { ...o, loadingImage: false } : o));
        }
      });

      await Promise.allSettled(imagePromises);

    } catch (err) {
      console.error(err);
      setError('Something went wrong during analysis. Please try again.');
      setStep('upload');
    }
  };

  const reset = () => {
    setStep('upload');
    setSelectedImage(null);
    setAnalysis(null);
    setOutfits([]);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-brand-offwhite text-brand-black font-sans relative overflow-x-hidden">
      {/* Background Graphic Elements */}
      <div className="absolute top-0 right-0 w-1/3 h-full bg-brand-panel -z-10 hidden lg:block" />
      <div className="absolute bottom-10 left-10 text-[180px] font-serif font-black opacity-[0.03] leading-none select-none pointer-events-none hidden lg:block">
        STYLIST
      </div>

      <header className="max-w-7xl mx-auto px-6 md:px-12 py-8 flex justify-between items-center border-b border-brand-border bg-brand-offwhite/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-brand-black rounded-full flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-brand-offwhite rotate-45"></div>
          </div>
          <span className="text-2xl font-serif font-bold tracking-tight italic uppercase">Cura</span>
        </div>
        
        <div className="flex items-center gap-6">
          {user ? (
            <div className="flex items-center gap-4">
              <nav className="hidden md:flex gap-8 text-[10px] uppercase tracking-[0.2em] font-bold">
                <button onClick={() => setStep('upload')} className={`${step === 'upload' || step === 'results' ? 'border-b border-brand-black pb-1' : 'opacity-40'} transition-all cursor-pointer`}>Studio</button>
                <button onClick={() => setStep('wardrobe')} className={`${step === 'wardrobe' ? 'border-b border-brand-black pb-1' : 'opacity-40'} transition-all cursor-pointer`}>Wardrobe</button>
                <button onClick={() => setStep('history')} className={`${step === 'history' ? 'border-b border-brand-black pb-1' : 'opacity-40'} transition-all cursor-pointer`}>History</button>
              </nav>
              <div className="h-4 w-px bg-brand-border mx-2 hidden md:block" />
              <div className="flex items-center gap-3">
                <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-brand-border" referrerPolicy="no-referrer" />
                <button onClick={logout} className="text-brand-black/40 hover:text-brand-black transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-black hover:text-brand-accent transition-colors"
            >
              <LogIn className="w-4 h-4" />
              Sign In
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-12 py-10 md:py-16">
        <AnimatePresence mode="wait">
          {step === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="grid lg:grid-cols-2 gap-16 md:gap-24 items-center"
            >
              <div className="space-y-10">
                <div className="space-y-4">
                  <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-black/40 block">Digital Atelier</span>
                  <h2 className="text-6xl md:text-8xl font-serif italic font-light leading-[1.1] tracking-tight">
                    I don't know what to wear with <span className="text-brand-accent">this.</span>
                  </h2>
                </div>
                
                <p className="text-xl font-serif italic text-brand-black/60 max-w-md leading-relaxed border-l-2 border-brand-accent pl-6">
                  Upload a vision of your most complex garment. Our curated AI will compose three distinct aesthetic directions for your consideration.
                </p>
                
                {error && (
                  <div className="bg-red-50 text-red-600 p-4 rounded-lg text-[10px] uppercase font-bold tracking-widest border border-red-100 italic">
                    Error: {error}
                  </div>
                )}

                <div className="flex flex-col gap-6 pt-4">
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    className="hidden" 
                    accept="image/*"
                  />
                  {!selectedImage ? (
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="group w-fit relative bg-brand-black text-brand-offwhite px-10 py-5 font-bold text-xs uppercase tracking-[0.2em] transition-all hover:pr-14 cursor-pointer overflow-hidden"
                    >
                      <span className="relative z-10 flex items-center gap-3">
                        <UploadIcon className="w-4 h-4" />
                        Initiate Wardrobe Scan
                      </span>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all">
                        <Sparkles className="w-4 h-4" />
                      </div>
                    </button>
                  ) : (
                    <div className="space-y-8">
                       <div className="relative w-fit">
                        <span className="absolute -top-3 -left-3 bg-brand-accent text-white text-[10px] font-bold px-3 py-1 uppercase tracking-tighter z-10">Base Item</span>
                        <div className="relative aspect-[3/4] w-64 md:w-80 bg-white border border-brand-border p-4 shadow-2xl rotate-2 hover:rotate-0 transition-transform duration-500 overflow-hidden">
                          <img 
                            src={selectedImage} 
                            alt="Selected garment" 
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover grayscale-[0.2] hover:grayscale-0 transition-all duration-700" 
                          />
                          <button 
                            onClick={() => setSelectedImage(null)}
                            className="absolute top-4 right-4 bg-brand-black/10 backdrop-blur-md text-brand-black p-2 rounded-full hover:bg-brand-black hover:text-white transition-colors cursor-pointer"
                          >
                            <ArrowLeft className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <button 
                        onClick={startAnalysis}
                        className="w-fit bg-brand-black text-white px-12 py-5 font-bold text-xs uppercase tracking-[0.25em] hover:bg-brand-black/90 transition-colors shadow-2xl cursor-pointer"
                      >
                        Generate Curated Ensembles
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="hidden lg:block relative group">
                <AnimatePresence>
                  {user && dailyPick ? (
                    <motion.div
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="relative"
                    >
                      <div className="absolute inset-0 border border-brand-black/5 -m-8 -z-10" />
                      <div className="bg-white border-2 border-brand-black p-8 shadow-2xl relative overflow-hidden group/pick">
                        <div className="absolute top-0 right-0 bg-brand-accent text-white text-[10px] font-black px-6 py-2 uppercase tracking-[0.3em] rotate-45 translate-x-8 translate-y-3">
                          Daily Pick
                        </div>
                        
                        <div className="space-y-6">
                           <div className="flex justify-between items-center border-b border-brand-border pb-4">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em]">{dailyPick.date} Selection</span>
                            <span className="text-[10px] opacity-40 uppercase font-black italic tracking-widest">{dailyPick.source === 'wardrobe' ? 'From Wardrobe' : 'AI Inspiration'}</span>
                          </div>

                          <div className="aspect-[3/4] bg-brand-offwhite relative overflow-hidden group-hover/pick:scale-[1.02] transition-transform duration-700">
                             <img 
                                src={dailyPick.outfit.imageUrl} 
                                alt="Daily Pick" 
                                className="w-full h-full object-cover grayscale-[0.3] hover:grayscale-0 transition-all duration-1000"
                                referrerPolicy="no-referrer"
                             />
                          </div>

                          <div className="space-y-4">
                             <h4 className="text-2xl font-serif italic">{dailyPick.outfit.outfitType} Direction</h4>
                             <p className="text-xs font-serif italic text-brand-black/60 leading-relaxed">
                               "{dailyPick.outfit.description}"
                             </p>
                             <div className="flex flex-wrap gap-2 pt-2">
                               {dailyPick.outfit.complementaryItems.slice(0, 3).map((item, i) => (
                                 <span key={i} className="text-[8px] font-black uppercase tracking-widest bg-brand-panel px-2 py-1">
                                   {item}
                                 </span>
                               ))}
                             </div>
                          </div>

                          <button 
                            onClick={() => {
                              setSelectedImage(dailyPick.outfit.imageUrl || null);
                              setAnalysis(null);
                              setOutfits([]);
                              // Re-trigger analysis logic manually? 
                              // Actually just show it
                            }}
                            className="w-full border border-brand-black py-4 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-brand-black hover:text-white transition-all cursor-pointer"
                          >
                            Explore This Aesthetic
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ) : loadingDaily ? (
                    <div className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-brand-border h-[600px]">
                      <Loader2 className="w-10 h-10 animate-spin opacity-20" />
                      <span className="text-[10px] uppercase font-bold tracking-[0.3em] mt-4 opacity-20">Curating Today's Pick</span>
                    </div>
                  ) : (
                    <>
                      <div className="absolute inset-0 border border-brand-black/5 -m-8 -z-10 group-hover:m-0 transition-all duration-700" />
                      <img 
                        src="https://images.unsplash.com/photo-1581044777550-4cfa60707c03?q=80&w=1280&auto=format&fit=crop" 
                        alt="Editorial Fashion" 
                        referrerPolicy="no-referrer"
                        className="relative rounded-sm shadow-2xl grayscale-[0.3] group-hover:grayscale-0 transition-all duration-1000"
                      />
                    </>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {step === 'analyzing' && (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-32 space-y-12"
            >
              <div className="relative w-24 h-24">
                <div className="absolute inset-0 border border-brand-black/20 animate-[spin_4s_linear_infinite]" />
                <div className="absolute inset-2 border border-brand-black/40 animate-[spin_2s_linear_infinite_reverse]" />
                <div className="absolute inset-4 border border-brand-black flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-brand-accent animate-pulse" />
                </div>
              </div>
              <div className="text-center space-y-4">
                <h3 className="text-4xl font-serif italic">Synthesizing Aesthetic...</h3>
                <p className="text-[10px] uppercase tracking-[0.4em] font-bold opacity-40">Deconstructing color / silhouette / context</p>
              </div>
              <div className="w-48 h-px bg-brand-black/10 relative overflow-hidden">
                <motion.div 
                  className="absolute inset-0 bg-brand-black"
                  initial={{ translateX: "-100%" }}
                  animate={{ translateX: "100%" }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            </motion.div>
          )}

          {step === 'wardrobe' && (
            <motion.div
              key="wardrobe"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-12"
            >
              <div className="flex justify-between items-end border-b border-brand-border pb-6">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-black/40 mb-3">Saved Ensembles</h4>
                  <h3 className="text-5xl font-serif italic">Your Wardrobe</h3>
                </div>
              </div>

              {savedOutfits.length === 0 ? (
                <div className="py-20 text-center border-2 border-dashed border-brand-border rounded-lg">
                  <Shirt className="w-12 h-12 mx-auto text-brand-black/10 mb-4" />
                  <p className="font-serif italic text-xl opacity-40 text-brand-black">Your curated archive is empty.</p>
                  <button onClick={() => setStep('upload')} className="mt-6 text-[10px] font-bold uppercase tracking-widest underline underline-offset-4 hover:text-brand-accent transition-colors">Start Creating</button>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
                  {savedOutfits.map((outfit) => (
                    <div key={outfit.id} className="bg-white border border-brand-border p-4 shadow-sm group">
                      <div className="aspect-[3/4] bg-brand-offwhite relative overflow-hidden mb-4">
                        <img src={outfit.imageUrl} alt={outfit.outfitType} className="w-full h-full object-cover grayscale-[0.5] group-hover:grayscale-0 transition-all duration-700" referrerPolicy="no-referrer" />
                        <button 
                          onClick={() => removeFromWardrobe(outfit.id!)}
                          className="absolute top-2 right-2 p-2 bg-white/80 backdrop-blur-md text-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                        <div className="absolute top-2 left-2 bg-brand-black text-white px-2 py-1 text-[8px] font-bold uppercase">{outfit.outfitType}</div>
                      </div>
                      <div className="space-y-4">
                        <p className="text-[10px] font-serif italic leading-relaxed opacity-60">"{outfit.description}"</p>
                        <div className="flex flex-wrap gap-1">
                          {outfit.complementaryItems.slice(0, 3).map((it, idx) => (
                            <span key={idx} className="text-[7px] font-bold uppercase tracking-tighter opacity-40"> • {it}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {step === 'history' && (
            <motion.div
              key="history"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-12"
            >
              <div className="flex justify-between items-end border-b border-brand-border pb-6">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-black/40 mb-3">Past Sessions</h4>
                  <h3 className="text-5xl font-serif italic">History</h3>
                </div>
              </div>

              {history.length === 0 ? (
                <div className="py-20 text-center border-2 border-dashed border-brand-border rounded-lg">
                  <HistoryIcon className="w-12 h-12 mx-auto text-brand-black/10 mb-4" />
                  <p className="font-serif italic text-xl opacity-40 text-brand-black">No styling history found.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {history.map((item) => (
                    <div key={item.id} className="flex gap-8 p-6 bg-white border border-brand-border items-center group hover:bg-brand-panel transition-colors cursor-pointer" onClick={() => {
                      setAnalysis(item.analysis);
                      setSelectedImage(item.baseItemImage);
                      setOutfits(item.analysis.outfits);
                      setStep('results');
                    }}>
                      <div className="w-24 h-32 flex-shrink-0 bg-brand-offwhite border border-brand-border p-2">
                        <img src={item.baseItemImage} alt={item.itemType} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      </div>
                      <div className="flex-1 space-y-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-brand-accent">
                          {item.createdAt?.toDate?.()?.toLocaleDateString() || 'Archive'}
                        </span>
                        <h4 className="text-2xl font-serif italic">{item.itemType} Analysis</h4>
                        <p className="text-xs opacity-60 line-clamp-1 italic">"{item.itemDescription}"</p>
                      </div>
                      <button className="p-4 rounded-full border border-brand-border bg-white opacity-0 group-hover:opacity-100 transition-all -translate-x-4 group-hover:translate-x-0">
                        <ArrowLeft className="w-4 h-4 rotate-180" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
          {step === 'results' && analysis && (
            <motion.div
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-20"
            >
              <section className="flex flex-col lg:flex-row gap-12 lg:gap-20 items-start">
                <div className="w-full lg:w-[350px] space-y-10">
                  <div className="relative">
                    <span className="absolute -top-3 -left-3 bg-brand-accent text-white text-[10px] font-bold px-3 py-1 uppercase tracking-tighter">Verified Input</span>
                    <div className="w-full aspect-[3/4] bg-white border border-brand-border p-6 shadow-sm">
                      <img src={selectedImage!} alt="Original" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  </div>
                  
                  <div className="p-8 bg-white border border-brand-border font-serif text-brand-black/70 italic text-lg leading-relaxed relative">
                    <div className="absolute top-0 right-0 w-8 h-8 bg-brand-panel -z-10" />
                    "{analysis.itemDescription}"
                  </div>
                </div>

                <div className="flex-1 space-y-12">
                  <div className="flex justify-between items-end border-b border-brand-border pb-6">
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-black/40 mb-3">Style Analysis</h4>
                      <h3 className="text-5xl font-serif italic">{analysis.itemType}</h3>
                    </div>
                    <p className="text-[10px] uppercase tracking-widest opacity-40 font-bold hidden md:block">Automated Curation v1.0</p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-12">
                    <div className="space-y-6">
                      <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-brand-black/40 underline underline-offset-8">
                        <Palette className="w-3 h-3" />
                        Dominant Tones
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {analysis.colorPalette.map((color, i) => (
                          <div key={i} className="flex items-center gap-2 group">
                            <div className="w-4 h-4 rounded-full border border-brand-black/10 group-hover:scale-125 transition-transform" style={{ backgroundColor: color.toLowerCase() }} />
                            <span className="text-[10px] uppercase tracking-widest font-bold opacity-60">
                              {color}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-6">
                      <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-brand-black/40 underline underline-offset-8">
                        <CheckCircle2 className="w-3 h-3" />
                        Core Aesthetic
                      </div>
                      <p className="font-serif italic text-2xl">{analysis.style}</p>
                    </div>
                  </div>
                </div>
              </section>

              <div className="space-y-12">
                <h4 className="text-[10px] font-bold uppercase tracking-[0.5em] text-center opacity-30">Curated Daily Directions</h4>
                <div className="grid lg:grid-cols-3 gap-8">
                  {outfits.map((outfit, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.2 }}
                      className={`group flex flex-col ${index === 2 ? 'lg:translate-y-4' : ''}`}
                    >
                      <div className={`bg-white border p-4 flex flex-col gap-4 shadow-sm hover:shadow-2xl transition-all duration-700 ${index === 2 ? 'border-brand-black shadow-lg' : 'border-brand-border'}`}>
                        <div className={`flex justify-between items-center border-b pb-3 ${index === 2 ? 'border-brand-black' : 'border-brand-border'}`}>
                          <span className="text-[10px] font-black uppercase tracking-[0.2em]">0{index + 1} {outfit.outfitType}</span>
                          <span className="text-[8px] opacity-40 uppercase font-black italic tracking-widest">Aesthetic Direction</span>
                        </div>
                        
                        <div className="aspect-[3/4] bg-brand-offwhite relative overflow-hidden">
                          {outfit.loadingImage ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-brand-black/20">
                              <Loader2 className="w-8 h-8 animate-spin" />
                              <span className="text-[9px] font-bold uppercase tracking-widest">Generating Plate</span>
                            </div>
                          ) : outfit.imageUrl ? (
                            <motion.img 
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              src={outfit.imageUrl} 
                              alt={outfit.outfitType} 
                              className="w-full h-full object-cover grayscale-[0.4] group-hover:grayscale-0 transition-all duration-1000 group-hover:scale-105"
                              referrerPolicy="no-referrer" 
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-brand-black/5">
                              <Shirt className="w-24 h-24" />
                            </div>
                          )}
                          <div className={`absolute bottom-4 right-4 ${index === 2 ? 'bg-brand-black text-white' : 'bg-brand-offwhite text-brand-black border border-brand-border'} px-3 py-1 text-[8px] font-bold uppercase tracking-widest`}>
                            {outfit.outfitType} Direction
                          </div>
                        </div>
                        
                        <div className="space-y-4 py-2">
                          <p className="text-[11px] font-serif italic leading-relaxed opacity-70">
                            "{outfit.description}"
                          </p>
                          <div className="space-y-3">
                            <h5 className="text-[9px] font-black uppercase tracking-[0.2em] opacity-30">Components</h5>
                            <ul className="grid grid-cols-2 gap-2">
                              {outfit.complementaryItems.map((item, i) => (
                                <li key={i} className="text-[9px] uppercase tracking-tighter font-bold flex items-center gap-2">
                                  <div className="w-1 h-1 bg-brand-accent rounded-full" />
                                  <span className="truncate">{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          
                          <button 
                            onClick={() => saveToWardrobe(outfit)}
                            disabled={!outfit.imageUrl || loadingWardrobe}
                            className="w-full mt-4 flex items-center justify-center gap-2 border border-brand-black/10 py-3 text-[10px] uppercase tracking-[0.2em] font-black hover:bg-brand-black hover:text-white transition-all disabled:opacity-20 cursor-pointer"
                          >
                            {savedOutfits.some(s => s.imageUrl === outfit.imageUrl) ? (
                              <>
                                <BookmarkCheck className="w-3 h-3 text-brand-accent" />
                                Saved to Wardrobe
                              </>
                            ) : (
                              <>
                                <Bookmark className="w-3 h-3" />
                                Save Direction
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                      <p className={`mt-6 text-xs font-serif italic text-center transition-all ${index === 2 ? 'font-bold opacity-100 scale-105' : 'opacity-50'}`}>
                        "{outfit.outfitType === 'Casual' ? 'The Weekend Vernissage' : outfit.outfitType === 'Business' ? 'The Creative Lead' : 'The Premiere After-party'}"
                      </p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="max-w-7xl mx-auto px-6 md:px-12 py-12 border-t border-brand-border mt-20 flex flex-col md:flex-row justify-between items-center gap-10">
        <div className="flex gap-12 text-[9px] uppercase tracking-[0.2em]">
          <div className="flex flex-col gap-2">
            <span className="opacity-30">Studio Output</span>
            <span className="font-bold">Validated</span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="opacity-30">Visual Context</span>
            <span className="font-bold">Medium-Heavy</span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="opacity-30">Occasion Range</span>
            <span className="font-bold">Multi-Versatile</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 text-[9px] uppercase tracking-[0.3em] font-light opacity-50 text-right">
          <span>Curated in AI Studio • Experimental v1.0</span>
          <span>© 2026 Cura Digital Archive</span>
        </div>
      </footer>
    </div>
  );
}
