"""Hugging Face Space entry point for CLUEZY backend."""

import os
import sys

# Ensure backend directory is in sys.path
backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import gradio as gr
import uvicorn
from app.main import create_application

# Initialize FastAPI backend
fastapi_app = create_application()

# Simple status & demo blocks interface for Hugging Face Space viewer
with gr.Blocks(title="CLUEZY AI Troubleshooting Engine") as demo:
    gr.Markdown("# 🔍 CLUEZY AI Diagnostic API")
    gr.Markdown(
        "The CLUEZY technical troubleshooting backend is active and serving API requests.\n\n"
        "- **API Health**: [/api/v1/health](/api/v1/health)\n"
        "- **Interactive Swagger Docs**: [/docs](/docs)\n"
        "- **Frontend Client**: Connects via Vercel"
    )

# Mount Gradio interface onto FastAPI root
app = gr.mount_gradio_app(fastapi_app, demo, path="/")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)

