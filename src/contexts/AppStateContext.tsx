"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState
} from "react";

type AppState = {
  quoteDraft?: {
    form?: any;
    formOpen?: boolean;
    editing?: any;
  };

  orderDraft?: any;

  filters: Record<string, any>;
};


type AppStateContextType = {
  state: AppState;
  updateState: (data: Partial<AppState>) => void;
  clearState: () => void;
};


const defaultState: AppState = {
  filters: {},
  quoteDraft: {
    formOpen: false,
    form: null,
    editing: null
  }
};


const AppStateContext =
  createContext<AppStateContextType | null>(null);



export function AppStateProvider({
  children
}: {
  children: React.ReactNode;
}) {


  const [state, setState] = useState<AppState>(() => {

    if (typeof window === "undefined") {
      return defaultState;
    }


    const saved =
      localStorage.getItem(
        "gestart-app-state"
      );


    if (!saved) {
      return defaultState;
    }


    try {

      return {
        ...defaultState,
        ...JSON.parse(saved)
      };

    } catch {

      return defaultState;

    }

  });



  useEffect(() => {

    localStorage.setItem(
      "gestart-app-state",
      JSON.stringify(state)
    );

  }, [state]);



  function updateState(
    data: Partial<AppState>
  ) {

    setState(prev => ({
      ...prev,
      ...data
    }));

  }



  function clearState() {

    setState(defaultState);

    localStorage.removeItem(
      "gestart-app-state"
    );

  }



  return (
    <AppStateContext.Provider
      value={{
        state,
        updateState,
        clearState
      }}
    >
      {children}
    </AppStateContext.Provider>
  );

}



export function useAppState() {

  const ctx =
    useContext(AppStateContext);


  if (!ctx) {

    throw new Error(
      "useAppState debe usarse dentro de AppStateProvider"
    );

  }


  return ctx;

}