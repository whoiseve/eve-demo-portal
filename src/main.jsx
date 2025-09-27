import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./routes/App.jsx";
import SubmitPage from "./routes/SubmitPage.jsx";
import AdminPage from "./routes/AdminPage.jsx";   // ⬅️ add

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <SubmitPage /> },
      { path: "admin", element: <AdminPage /> },   // ⬅️ add
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
